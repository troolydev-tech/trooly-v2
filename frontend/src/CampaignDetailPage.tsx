import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

type Campaign = {
  id: string;
  name: string;
  status: string;
  product_id: string | null;
  internal_notes: string | null;
  email_length: string | null;
  email_tone: string | null;
  call_to_action: string | null;
  campaign_goal: string | null;
};

type CampaignProspect = {
  id: string;
  prospect_id: string;
  status: string;
  relevance_score: number | null;
  hook: string | null;
  prospects: { name: string; institution: string; department: string | null; email: string | null };
};

type GeneratedEmail = {
  id: string;
  prospect_id: string;
  subject: string;
  body: string;
  cost_usd: number | null;
};

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [cps, setCps] = useState<CampaignProspect[]>([]);
  const [emails, setEmails] = useState<GeneratedEmail[]>([]);
  const [activeEmailId, setActiveEmailId] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [backendReady, setBackendReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: c } = await supabase.from('campaigns').select('*').eq('id', id).single();
    if (c) setCampaign(c as Campaign);

    const { data: cpData } = await supabase
      .from('campaign_prospects')
      .select('*, prospects(*)')
      .eq('campaign_id', id);
    setCps((cpData ?? []) as CampaignProspect[]);

    const { data: eData } = await supabase
      .from('generated_emails')
      .select('*')
      .eq('campaign_id', id);
    setEmails((eData ?? []) as GeneratedEmail[]);
  }, [id]);

  useEffect(() => {
    fetch('/api/health').then((r) => r.ok).then(setBackendReady).catch(() => setBackendReady(false));
    load();
  }, [load]);

  useEffect(() => {
    if (!campaign || (campaign.status !== 'running' && campaign.status !== 'queued')) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [campaign, load]);

  const activeEmail = emails.find((e) => e.id === activeEmailId) ?? emails[0];
  const avgScore = cps.map((cp) => cp.relevance_score).filter((s): s is number => s != null);
  const avg = avgScore.length > 0 ? avgScore.reduce((a, b) => a + b, 0) / avgScore.length : 0;

  const handleRun = async () => {
    if (!campaign) return;
    setRunning(true); setError(''); setNotice('');
    try {
      const payload = {
        campaign_id: campaign.id,
        prospects: cps.map((cp) => ({
          prospect_id: cp.prospect_id,
          campaign_id: campaign.id,
          name: cp.prospects.name,
          institution: cp.prospects.institution,
          department: cp.prospects.department ?? undefined,
          email: cp.prospects.email ?? undefined,
        })),
      };
      const res = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Rejected');
      await supabase.from('campaigns').update({ status: 'running' }).eq('id', campaign.id);
      setNotice(`Engine accepted ${data.accepted} prospects.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!campaign) return <main className="workspace" style={{ padding: '2rem' }}>Loading…</main>;

  return (
    <main className="workspace" style={{ padding: '2rem' }}>
      <header className="workspace-header">
        <div>
          <button type="button" className="ghost-button" onClick={() => navigate('/campaigns')}>
            ← All campaigns
          </button>
          <h2>{campaign.name}</h2>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${backendReady ? 'success' : 'weak'}`}>
            {backendReady ? 'Backend online' : 'Backend offline'}
          </span>
          <button type="button" className="primary-button" onClick={handleRun}
            disabled={cps.length === 0 || running}>
            {running ? 'Sending…' : 'Run campaign'}
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card"><span>Prospects</span><strong>{cps.length}</strong></article>
        <article className="stat-card"><span>Emails</span><strong>{emails.length}</strong></article>
        <article className="stat-card"><span>Avg. score</span><strong>{avg > 0 ? avg.toFixed(1) : '—'}</strong></article>
        <article className="stat-card"><span>Status</span><strong>{campaign.status}</strong></article>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header"><h3>Prospect list</h3><span>{cps.length} people</span></div>
          <div className="prospect-list">
            {cps.length === 0
              ? <p className="empty-state">No prospects.</p>
              : cps.map((cp) => (
                <div key={cp.id} className="prospect-row">
                  <div>
                    <strong>{cp.prospects.name}</strong>
                    <small>{cp.prospects.institution} · {cp.prospects.department ?? 'No dept'}</small>
                  </div>
                  <span>{cp.relevance_score != null ? `Score ${cp.relevance_score.toFixed(1)}` : cp.status}</span>
                </div>
              ))
            }
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Generated emails</h3><span>{emails.length}</span></div>
          <div className="results-table">
            {emails.length === 0
              ? <p className="empty-state">No emails yet.</p>
              : emails.map((e) => {
                const cp = cps.find((c) => c.prospect_id === e.prospect_id);
                return (
                  <button key={e.id} type="button"
                    className={`result-row ${activeEmail?.id === e.id ? 'selected' : ''}`}
                    onClick={() => setActiveEmailId(e.id)}>
                    <span>{cp?.prospects.name ?? 'Unknown'}</span>
                    <span>{cp?.relevance_score?.toFixed(1) ?? '—'}</span>
                    <span>{e.cost_usd ? `$${e.cost_usd.toFixed(4)}` : ''}</span>
                  </button>
                );
              })
            }
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header"><h3>Email preview</h3></div>
        {activeEmail ? (
          <div className="preview-card">
            <p className="preview-label">Subject</p>
            <h4>{activeEmail.subject}</h4>
            <p className="preview-label">Body</p>
            <p className="body-copy" style={{ whiteSpace: 'pre-wrap' }}>{activeEmail.body}</p>
          </div>
        ) : (
          <p className="empty-state">Select an email to preview.</p>
        )}
      </section>

      {(notice || error) && <div className={`alert ${error ? 'error' : 'success'}`}>{error || notice}</div>}
    </main>
  );
}