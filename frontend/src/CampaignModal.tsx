import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { supabase } from './lib/supabase';
const COST_PER_PROSPECT_USD = 0.022;

type Product = { id: string; name: string; company_id: string };
type Sender = { id: string; name: string; title: string; company_id: string; is_default: boolean };

type DraftProspect = { name: string; institution: string; department: string; email: string };

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseCsvLeads(csvText: string): DraftProspect[] {
  const rows = csvText.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows.length < 2) return [];
  const headers = splitCsvLine(rows[0]).map((h) => h.toLowerCase().trim());
  const find = (row: string[], aliases: string[]) => {
    const i = headers.findIndex((h) => aliases.includes(h));
    if (i === -1 || !row[i]) return '';
    return row[i].replace(/^"|"$/g, '').trim();
  };
  return rows.slice(1).map(splitCsvLine).filter((r) => r.some((c) => c.trim().length > 0))
    .map((row) => ({
      name: find(row, ['name', 'full_name', 'person']),
      institution: find(row, ['institution', 'company', 'organization', 'university']),
      department: find(row, ['department', 'team', 'division']),
      email: find(row, ['email', 'email_address', 'mail']),
    }))
    .filter((p) => p.name || p.institution);
}

type Props = { onClose: () => void; onCreated: (campaignId: string) => void };

export function CampaignModal({ onClose, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);

  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [notes, setNotes] = useState('');
  const [senderId, setSenderId] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderTitle, setNewSenderTitle] = useState('');
  const [leads, setLeads] = useState<DraftProspect[]>([]);
  const [csvFileName, setCsvFileName] = useState('');

  const [emailLength, setEmailLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [emailTone, setEmailTone] = useState('company_default');
  const [callToAction, setCallToAction] = useState('request_a_demo');
  const [campaignGoal, setCampaignGoal] = useState('awareness');
  const [additionalInstructions, setAdditionalInstructions] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load products + senders on open
  const loadOptions = useCallback(async () => {
    const { data: p } = await supabase.from('products').select('id, name, company_id').order('name');
    setProducts((p ?? []) as Product[]);
    const { data: s } = await supabase.from('senders').select('*').order('created_at', { ascending: false });
    setSenders((s ?? []) as Sender[]);
  }, []);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  // When product picked, auto-filter senders to that product's company
  const selectedProduct = products.find((p) => p.id === productId);
  const filteredSenders = selectedProduct
    ? senders.filter((s) => s.company_id === selectedProduct.company_id)
    : senders;

  // When product changes and default sender exists, auto-select it
  useEffect(() => {
    if (!selectedProduct) return;
    const def = senders.find((s) => s.company_id === selectedProduct.company_id && s.is_default);
    if (def) setSenderId(def.id);
    else if (filteredSenders.length > 0) setSenderId(filteredSenders[0].id);
    else setSenderId('');
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimatedCost = useMemo(() => leads.length * COST_PER_PROSPECT_USD, [leads]);

  const handleCsvUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvLeads(String(reader.result ?? ''));
      if (parsed.length === 0) { setError('CSV empty or missing name/institution columns.'); return; }
      setLeads(parsed); setCsvFileName(file.name); setError('');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const validate = (): string[] => {
    const missing: string[] = [];
    if (!name.trim()) missing.push('Campaign name');
    if (!productId) missing.push('Product');
    if (leads.length === 0) missing.push('Leads CSV');
    const hasSender = senderId || (newSenderName.trim() && newSenderTitle.trim());
    if (!hasSender) missing.push('Sender');
    return missing;
  };

  const missing = validate();
  const ready = missing.length === 0;

  const handleSubmit = async (e: FormEvent, alsoRun: boolean) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true); setError('');

    try {
      // 1. Sender: create new if needed
      let finalSenderName = '';
      let finalSenderTitle = '';
      if (senderId) {
        const s = senders.find((x) => x.id === senderId);
        finalSenderName = s?.name ?? ''; finalSenderTitle = s?.title ?? '';
      } else {
        const product = products.find((p) => p.id === productId);
        const { data: newS, error: sErr } = await supabase.from('senders').insert({
          company_id: product?.company_id,
          name: newSenderName.trim(),
          title: newSenderTitle.trim(),
          is_default: senders.filter((x) => x.company_id === product?.company_id).length === 0,
        }).select().single();
        if (sErr || !newS) throw new Error(`Failed to save sender: ${sErr?.message}`);
        finalSenderName = newS.name; finalSenderTitle = newS.title;
      }

      // 2. Create the campaign
      const product = products.find((p) => p.id === productId);
      const { data: c, error: cErr } = await supabase.from('campaigns').insert({
        name: name.trim(),
        product_id: productId,
        company_id: product?.company_id,
        internal_notes: notes.trim() || null,
        sender_name: finalSenderName,
        sender_title: finalSenderTitle,
        email_length: emailLength,
        email_tone: emailTone,
        call_to_action: callToAction,
        campaign_goal: campaignGoal,
        additional_instructions: additionalInstructions.trim() || null,
        status: alsoRun ? 'queued' : 'draft',
      }).select().single();
      if (cErr || !c) throw new Error(`Failed to create campaign: ${cErr?.message}`);

      // 3. Insert prospects
      const prospectRows = leads.map((l) => ({
        name: l.name.trim(), institution: l.institution.trim(),
        department: l.department.trim() || null,
        email: l.email.trim() || null,
      }));
      const { data: newProspects, error: pErr } = await supabase.from('prospects').insert(prospectRows).select();
      if (pErr || !newProspects) throw new Error(`Failed to save prospects: ${pErr?.message}`);

      // 4. Link them
      const linkRows = newProspects.map((p) => ({
        campaign_id: c.id, prospect_id: p.id, status: 'pending',
      }));
      const { error: lErr } = await supabase.from('campaign_prospects').insert(linkRows);
      if (lErr) throw new Error(`Failed to link prospects: ${lErr.message}`);

      // 5. If "Run now", fire off to engine
      if (alsoRun) {
        void fetch('/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: c.id,
            prospects: newProspects.map((p, i) => ({
              prospect_id: p.id, campaign_id: c.id,
              name: leads[i].name, institution: leads[i].institution,
              department: leads[i].department || undefined,
              email: leads[i].email || undefined,
            })),
          }),
        });
      }

      onCreated(c.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow dark">Create campaign</p>
            <h2>New campaign</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
        </div>

        <form className="modal-body" onSubmit={(e) => handleSubmit(e, false)}>
          {/* Basics */}
          <section className="panel">
            <div className="panel-header"><h3>Campaign basics</h3></div>
            <div className="composer-form">
              <label className="field">
                <span>Campaign name *</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 University outreach" />
              </label>
              <label className="field">
                <span>Product *</span>
                <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select a product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Internal notes <span style={{ opacity: 0.6 }}>(optional, not sent to leads)</span></span>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Context for your team" />
              </label>
            </div>
          </section>

          {/* Sender */}
          <section className="panel">
            <div className="panel-header"><h3>Sender identity</h3></div>
            <div className="composer-form">
              {filteredSenders.length > 0 && (
                <label className="field">
                  <span>Use a saved sender</span>
                  <select value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                    <option value="">— New sender —</option>
                    {filteredSenders.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {s.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {!senderId && (
                <>
                  <label className="field">
                    <span>Sender name *</span>
                    <input value={newSenderName} onChange={(e) => setNewSenderName(e.target.value)}
                      placeholder="Rajesh Kumar" />
                  </label>
                  <label className="field">
                    <span>Sender title *</span>
                    <input value={newSenderTitle} onChange={(e) => setNewSenderTitle(e.target.value)}
                      placeholder="Sales Manager" />
                  </label>
                </>
              )}
            </div>
          </section>

          {/* Lead upload */}
          <section className="panel">
            <div className="panel-header"><h3>Lead upload</h3></div>
            <div className="upload-box">
              <label htmlFor="csv" className="upload-label">Upload CSV of leads *</label>
              <input id="csv" type="file" accept=".csv" onChange={handleCsvUpload} />
              <small className="helper-text">
                Required columns: name, institution. Optional: department, email.
              </small>
              {csvFileName && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                  {csvFileName} — <strong>{leads.length}</strong> leads detected
                </div>
              )}
            </div>
          </section>

          {/* Outreach config */}
          <section className="panel">
            <div className="panel-header"><h3>Outreach configuration</h3><span>Shape how Trooly writes to your leads</span></div>
            <div className="composer-form">
              <div className="field">
                <span>Message length</span>
                <div className="length-picker">
                  {(['short', 'medium', 'long'] as const).map((len) => (
                    <button key={len} type="button"
                      className={`length-option ${emailLength === len ? 'active' : ''}`}
                      onClick={() => setEmailLength(len)}>
                      <strong>{len[0].toUpperCase() + len.slice(1)}</strong>
                      <small>
                        {len === 'short' && '3 sentences'}
                        {len === 'medium' && '120 words'}
                        {len === 'long' && '200 words'}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Tone</span>
                <select value={emailTone} onChange={(e) => setEmailTone(e.target.value)}>
                  <option value="company_default">Company default</option>
                  <option value="formal">Professional and formal</option>
                  <option value="friendly">Conversational and friendly</option>
                  <option value="technical">Technical and precise</option>
                  <option value="warm">Consultative and warm</option>
                  <option value="direct">Bold and direct</option>
                </select>
              </label>
              <label className="field">
                <span>Call to action</span>
                <select value={callToAction} onChange={(e) => setCallToAction(e.target.value)}>
                  <option value="request_a_demo">Request a demo</option>
                  <option value="schedule_a_call">Schedule a call</option>
                  <option value="visit_our_website">Visit our website</option>
                  <option value="reply_to_email">Reply to this email</option>
                </select>
              </label>
              <label className="field">
                <span>Campaign goal</span>
                <select value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value)}>
                  <option value="awareness">Awareness</option>
                  <option value="demo_request">Demo request</option>
                  <option value="partnership">Partnership</option>
                  <option value="event_invite">Event invite</option>
                </select>
              </label>
              <label className="field">
                <span>Additional instructions <span style={{ opacity: 0.6 }}>(optional)</span></span>
                <textarea rows={2} value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                  placeholder="Specific points you want included in every email" />
              </label>
            </div>
          </section>
        </form>

        {/* Sticky Review & Launch bar */}
        <div className="modal-footer">
          <div className="review-stats">
            <div><span>Total leads</span><strong>{leads.length}</strong></div>
            <div><span>Est. cost</span><strong>${estimatedCost.toFixed(2)}</strong></div>
            <div><span>Product</span><strong>{selectedProduct?.name ?? '—'}</strong></div>
          </div>
          {missing.length > 0 && (
            <div className="alert warning">Still needed: {missing.join(', ')}</div>
          )}
          {error && <div className="alert error">{error}</div>}
          <div className="composer-actions">
            <button type="button" className="secondary-button" onClick={(e) => handleSubmit(e as any, false)}
              disabled={saving || !ready}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" className="primary-button" onClick={(e) => handleSubmit(e as any, true)}
              disabled={saving || !ready}>
              {saving ? 'Sending…' : 'Run campaign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}