import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// ─── Supabase client ────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// ─── Types matching your Supabase schema ────────────────────────
type Campaign = {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  sender_name: string | null;
  sender_title: string | null;
  created_at: string;
  company_id: string | null;
  product_id: string | null;
};

type Prospect = {
  id: string;
  name: string;
  institution: string;
  department: string | null;
  email: string | null;
};

type CampaignProspect = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  status: string;
  relevance_score: number | null;
  hook: string | null;
  prospects: Prospect;
};

type GeneratedEmail = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  subject: string;
  body: string;
  cost_usd: number | null;
};

// ─── Draft prospect for the composer form ───────────────────────
type DraftProspect = {
  tempId: string;
  name: string;
  institution: string;
  department: string;
  email: string;
};

const createDraftProspect = (): DraftProspect => ({
  tempId: crypto.randomUUID(),
  name: '',
  institution: '',
  department: '',
  email: '',
});

// ─── CSV parsing helpers ────────────────────────────────────────
const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

const parseCsvLeads = (csvText: string): DraftProspect[] => {
  const rows = csvText.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows.length < 2) return [];
  const headers = splitCsvLine(rows[0]).map((h) => h.toLowerCase().trim());
  const findValue = (row: string[], aliases: string[]) => {
    const i = headers.findIndex((h) => aliases.includes(h));
    if (i === -1 || !row[i]) return '';
    return row[i].replace(/^"|"$/g, '').trim();
  };
  return rows.slice(1)
    .map(splitCsvLine)
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((row) => ({
      tempId: crypto.randomUUID(),
      name: findValue(row, ['name', 'full_name', 'person']),
      institution: findValue(row, ['institution', 'company', 'organization', 'university']),
      department: findValue(row, ['department', 'team', 'division']),
      email: findValue(row, ['email', 'email_address', 'mail']),
    }))
    .filter((p) => p.name || p.institution);
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));

// ─── Main component ─────────────────────────────────────────────
function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [campaignProspects, setCampaignProspects] = useState<CampaignProspect[]>([]);
  const [emails, setEmails] = useState<GeneratedEmail[]>([]);
  const [backendReady, setBackendReady] = useState<boolean>(false);
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [runState, setRunState] = useState<'idle' | 'loading'>('idle');

  // Composer state
  const [campaignName, setCampaignName] = useState<string>('New campaign');
  const [drafts, setDrafts] = useState<DraftProspect[]>([createDraftProspect()]);
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [activeEmailId, setActiveEmailId] = useState<string>('');

  // ─── Load campaigns from Supabase ─────────────────────────────
  const loadCampaigns = useCallback(async () => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { setError(`Failed to load campaigns: ${error.message}`); return; }
    setCampaigns(data ?? []);
    if (data && data.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(data[0].id);
    }
  }, [selectedCampaignId]);

  // ─── Load prospects + emails for the selected campaign ────────
  const loadCampaignDetails = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    const { data: cpData } = await supabase
      .from('campaign_prospects')
      .select('*, prospects(*)')
      .eq('campaign_id', campaignId);
    setCampaignProspects((cpData ?? []) as CampaignProspect[]);

    const { data: emailData } = await supabase
      .from('generated_emails')
      .select('*')
      .eq('campaign_id', campaignId);
    setEmails(emailData ?? []);
  }, []);

  // ─── Health check + initial load ──────────────────────────────
  useEffect(() => {
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        setBackendReady(Boolean(d?.ok));
      })
      .catch(() => setBackendReady(false));
    loadCampaigns();
  }, [loadCampaigns]);

  // ─── Reload details whenever selection changes ────────────────
  useEffect(() => {
    if (selectedCampaignId) loadCampaignDetails(selectedCampaignId);
  }, [selectedCampaignId, loadCampaignDetails]);

  // ─── Poll every 3 seconds while a campaign is running ─────────
  useEffect(() => {
    if (!selectedCampaignId) return;
    const selected = campaigns.find((c) => c.id === selectedCampaignId);
    if (!selected || (selected.status !== 'running' && selected.status !== 'queued')) return;
    const interval = setInterval(() => {
      loadCampaignDetails(selectedCampaignId);
      loadCampaigns();
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedCampaignId, campaigns, loadCampaignDetails, loadCampaigns]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  const summary = useMemo(() => {
    const totalProspects = campaignProspects.length;
    const totalEmails = emails.length;
    const scores = campaignProspects
      .map((cp) => cp.relevance_score)
      .filter((s): s is number => s !== null);
    const avgScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : 0;
    return { totalProspects, totalEmails, avgScore };
  }, [campaignProspects, emails]);

  const activeEmail = emails.find((e) => e.id === activeEmailId) ?? emails[0];

  // ─── Update draft prospects in composer ───────────────────────
  const updateDraft = (index: number, key: keyof DraftProspect, value: string) => {
    setDrafts((current) =>
      current.map((d, i) => (i === index ? { ...d, [key]: value } : d)),
    );
  };

  const addDraft = () => setDrafts((c) => [...c, createDraftProspect()]);
  const removeDraft = (index: number) =>
    setDrafts((c) => c.filter((_, i) => i !== index));

  // ─── CSV upload ───────────────────────────────────────────────
  const handleCsvUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvLeads(String(reader.result ?? ''));
      if (!parsed.length) {
        setError('CSV appears empty or missing name/institution columns.');
        return;
      }
      setDrafts(parsed);
      setCsvFileName(file.name);
      setNotice(`${parsed.length} leads loaded from ${file.name}.`);
      setError('');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // ─── Save a new campaign to Supabase ──────────────────────────
  const handleSaveCampaign = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const validDrafts = drafts.filter((d) => d.name.trim() && d.institution.trim());
    if (validDrafts.length === 0) {
      setError('Add at least one prospect with a name and institution.');
      return;
    }

    // 1. Create the campaign row (real UUID auto-generated by Supabase)
    const { data: campaignData, error: campErr } = await supabase
      .from('campaigns')
      .insert({ name: campaignName.trim() || 'Untitled campaign', status: 'draft' })
      .select()
      .single();

    if (campErr || !campaignData) {
      setError(`Failed to create campaign: ${campErr?.message}`);
      return;
    }

    // 2. Insert all prospects
    const prospectRows = validDrafts.map((d) => ({
      name: d.name.trim(),
      institution: d.institution.trim(),
      department: d.department.trim() || null,
      email: d.email.trim() || null,
    }));

    const { data: newProspects, error: propErr } = await supabase
      .from('prospects')
      .insert(prospectRows)
      .select();

    if (propErr || !newProspects) {
      setError(`Failed to save prospects: ${propErr?.message}`);
      return;
    }

    // 3. Link every prospect to the campaign
    const linkRows = newProspects.map((p) => ({
      campaign_id: campaignData.id,
      prospect_id: p.id,
      status: 'pending',
    }));

    const { error: linkErr } = await supabase.from('campaign_prospects').insert(linkRows);
    if (linkErr) { setError(`Failed to link prospects: ${linkErr.message}`); return; }

    setNotice(`Campaign "${campaignData.name}" saved with ${newProspects.length} prospects.`);
    setCampaignName('New campaign');
    setDrafts([createDraftProspect()]);
    setCsvFileName('');
    await loadCampaigns();
    setSelectedCampaignId(campaignData.id);
  };

  // ─── Trigger the engine to research + write emails ────────────
  const handleRunCampaign = async () => {
    if (!selectedCampaign) return;
    setRunState('loading');
    setError('');
    setNotice('');

    try {
      const payload = {
        campaign_id: selectedCampaign.id,
        prospects: campaignProspects.map((cp) => ({
          prospect_id: cp.prospect_id,
          campaign_id: selectedCampaign.id,
          name: cp.prospects.name,
          institution: cp.prospects.institution,
          department: cp.prospects.department ?? undefined,
          email: cp.prospects.email ?? undefined,
        })),
      };

      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? 'Backend rejected the request.');

      await supabase
        .from('campaigns')
        .update({ status: 'running' })
        .eq('id', selectedCampaign.id);

      setNotice(`Engine accepted ${data.accepted} prospects. Results will appear shortly.`);
      loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunState('idle');
    }
  };

  // ─── UI ───────────────────────────────────────────────────────
  return (
    <div className="layout-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Trooly</p>
          <h1>Engine</h1>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <span>Campaigns</span>
          </div>

          <div className="campaign-list">
            {campaigns.length === 0 ? (
              <p className="empty-state">No campaigns yet. Create one below.</p>
            ) : (
              campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`campaign-item ${c.id === selectedCampaignId ? 'active' : ''}`}
                  onClick={() => setSelectedCampaignId(c.id)}
                >
                  <div className="campaign-name-row">
                    <span>{c.name}</span>
                    <span className={`status-pill ${c.status.toLowerCase()}`}>{c.status}</span>
                  </div>
                  <small>{formatDate(c.created_at)}</small>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow dark">Campaign dashboard</p>
            <h2>{selectedCampaign?.name ?? 'Select or create a campaign'}</h2>
          </div>
          <div className="header-actions">
            <span className={`status-pill ${backendReady ? 'success' : 'weak'}`}>
              {backendReady ? 'Backend online' : 'Backend offline'}
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={handleRunCampaign}
              disabled={!selectedCampaign || campaignProspects.length === 0 || runState === 'loading'}
            >
              {runState === 'loading' ? 'Sending...' : 'Run campaign'}
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card">
            <span>Prospects</span>
            <strong>{summary.totalProspects}</strong>
          </article>
          <article className="stat-card">
            <span>Emails</span>
            <strong>{summary.totalEmails}</strong>
          </article>
          <article className="stat-card">
            <span>Avg. score</span>
            <strong>{summary.avgScore > 0 ? summary.avgScore.toFixed(1) : '—'}</strong>
          </article>
          <article className="stat-card">
            <span>Status</span>
            <strong>{selectedCampaign?.status ?? '—'}</strong>
          </article>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h3>Prospect list</h3>
              <span>{campaignProspects.length} people</span>
            </div>
            <div className="prospect-list">
              {campaignProspects.length === 0 ? (
                <p className="empty-state">No prospects on this campaign yet.</p>
              ) : (
                campaignProspects.map((cp) => (
                  <div key={cp.id} className="prospect-row">
                    <div>
                      <strong>{cp.prospects.name}</strong>
                      <small>
                        {cp.prospects.institution} · {cp.prospects.department ?? 'No department'}
                      </small>
                    </div>
                    <span>
                      {cp.relevance_score !== null
                        ? `Score ${cp.relevance_score.toFixed(1)}`
                        : cp.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Generated emails</h3>
              <span>{emails.length} items</span>
            </div>
            <div className="results-table">
              {emails.length === 0 ? (
                <p className="empty-state">No emails yet for this campaign.</p>
              ) : (
                emails.map((e) => {
                  const cp = campaignProspects.find((c) => c.prospect_id === e.prospect_id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={`result-row ${activeEmail?.id === e.id ? 'selected' : ''}`}
                      onClick={() => setActiveEmailId(e.id)}
                    >
                      <span>{cp?.prospects.name ?? 'Unknown'}</span>
                      <span>{cp?.relevance_score?.toFixed(1) ?? '—'}</span>
                      <span>{e.cost_usd ? `$${e.cost_usd.toFixed(4)}` : ''}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="detail-grid">
          <div className="panel compose-panel">
            <div className="panel-header">
              <h3>Create campaign</h3>
            </div>
            <form onSubmit={handleSaveCampaign} className="composer-form">
              <label className="field">
                <span>Campaign name</span>
                <input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                />
              </label>

              <div className="upload-box">
                <label htmlFor="csv-upload" className="upload-label">Upload CSV leads</label>
                <input id="csv-upload" type="file" accept=".csv,text/csv" onChange={handleCsvUpload} />
                <small className="helper-text">
                  Headers: name, institution, department, email.
                </small>
                {csvFileName ? <span className="csv-file-name">Loaded: {csvFileName}</span> : null}
              </div>

              {drafts.map((d, i) => (
                <div key={d.tempId} className="composer-row">
                  <input value={d.name} placeholder="Name"
                    onChange={(e) => updateDraft(i, 'name', e.target.value)} />
                  <input value={d.institution} placeholder="Institution"
                    onChange={(e) => updateDraft(i, 'institution', e.target.value)} />
                  <input value={d.department} placeholder="Department"
                    onChange={(e) => updateDraft(i, 'department', e.target.value)} />
                  <button type="button" className="ghost-button" onClick={() => removeDraft(i)}>
                    Remove
                  </button>
                </div>
              ))}

              <div className="composer-actions">
                <button type="button" className="secondary-button" onClick={addDraft}>
                  Add prospect
                </button>
                <button type="submit" className="primary-button">
                  Save campaign
                </button>
              </div>
            </form>
          </div>

          <div className="panel preview-panel">
            <div className="panel-header">
              <h3>Email preview</h3>
            </div>
            {activeEmail ? (
              <div className="preview-card">
                <p className="preview-label">Subject</p>
                <h4>{activeEmail.subject}</h4>
                <p className="preview-label">Body</p>
                <p className="body-copy" style={{ whiteSpace: 'pre-wrap' }}>{activeEmail.body}</p>
              </div>
            ) : (
              <p className="empty-state">Select an email to inspect.</p>
            )}
          </div>
        </section>

        {(notice || error) && (
          <div className={`alert ${error ? 'error' : 'success'}`}>{error || notice}</div>
        )}
      </main>
    </div>
  );
}

export default App;