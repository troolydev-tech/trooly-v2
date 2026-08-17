import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  product_name: string | null;
  leads: number;
  emails: number;
  avg_score: number | null;
  cost_usd: number;
};

const formatDate = (v: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(v));

export function CampaignsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: campaigns, error: cErr } = await supabase
      .from('campaigns')
      .select('id, name, status, updated_at, created_at, products(name)')
      .order('created_at', { ascending: false });
    if (cErr) { setError(cErr.message); setLoading(false); return; }

    // For each campaign, fetch its stats. This is a few round-trips, fine for now.
    const enriched: CampaignRow[] = await Promise.all(
      (campaigns ?? []).map(async (c) => {
        const cid = c.id as string;
        const { data: cps } = await supabase
          .from('campaign_prospects')
          .select('relevance_score')
          .eq('campaign_id', cid);
        const { data: emails } = await supabase
          .from('generated_emails')
          .select('cost_usd')
          .eq('campaign_id', cid);
        const scores = (cps ?? []).map((r) => r.relevance_score).filter((s): s is number => s != null);
        const product = Array.isArray(c.products) ? c.products[0] : c.products;
        return {
          id: cid,
          name: c.name as string,
          status: c.status as string,
          updated_at: (c.updated_at ?? c.created_at) as string,
          product_name: (product as { name?: string } | null)?.name ?? null,
          leads: (cps ?? []).length,
          emails: (emails ?? []).length,
          avg_score: scores.length > 0 ? scores.reduce((s, n) => s + n, 0) / scores.length : null,
          cost_usd: (emails ?? []).reduce((s, e) => s + (e.cost_usd ?? 0), 0),
        };
      }),
    );

    setRows(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="workspace" style={{ padding: '2rem' }}>
      <header className="workspace-header">
        <div>
          <p className="eyebrow dark">Campaigns</p>
          <h2>All campaigns</h2>
        </div>
        <div className="header-actions">
          <button type="button" className="primary-button" onClick={() => setShowModal(true)}>
            + New Campaign
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header">
          <h3>{rows.length} campaigns</h3>
        </div>

        {loading ? (
          <p className="empty-state" style={{ padding: '1.5rem' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty-state" style={{ padding: '1.5rem' }}>
            No campaigns yet. Click "+ New Campaign" to start.
          </p>
        ) : (
          <div className="campaigns-table">
            <div className="campaigns-table-header">
              <span>Campaign</span>
              <span>Product</span>
              <span>Leads</span>
              <span>Emails</span>
              <span>Avg Score</span>
              <span>Cost</span>
              <span>Status</span>
              <span>Updated</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className="campaigns-table-row"
                onClick={() => navigate(`/campaigns/${r.id}`)}
              >
                <span className="cell-strong">{r.name}</span>
                <span>{r.product_name ?? <em style={{ opacity: 0.5 }}>Not set</em>}</span>
                <span>{r.leads}</span>
                <span>{r.emails}</span>
                <span>{r.avg_score != null ? r.avg_score.toFixed(1) : '—'}</span>
                <span>{r.cost_usd > 0 ? `$${r.cost_usd.toFixed(4)}` : '—'}</span>
                <span><span className={`status-pill ${r.status.toLowerCase()}`}>{r.status}</span></span>
                <span>{formatDate(r.updated_at)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {showModal && (
        <CampaignModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => {
            setShowModal(false);
            load();
            navigate(`/campaigns/${id}`);
          }}
        />
      )}
    </main>
  );
}