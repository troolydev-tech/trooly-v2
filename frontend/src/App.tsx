import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import './App.css';

type Prospect = {
  id: string;
  name: string;
  institution: string;
  department: string;
  email?: string;
};

type Result = {
  id: string;
  prospectName: string;
  score: number;
  verdict: 'Strong' | 'Moderate' | 'Weak';
  subject: string;
  body: string;
  reason: string;
};

type Campaign = {
  id: string;
  name: string;
  status: 'Draft' | 'Queued' | 'Running' | 'Complete';
  createdAt: string;
  updatedAt: string;
  prospects: Prospect[];
  results: Result[];
};

const createProspect = (
  name = '',
  institution = '',
  department = '',
  email = '',
): Prospect => ({
  id: crypto.randomUUID(),
  name,
  institution,
  department,
  email,
});

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseCsvLeads = (csvText: string): Prospect[] => {
  const rows = csvText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const headers = splitCsvLine(rows[0]).map((header) => header.toLowerCase().trim());
  const leadRows = rows.slice(1);

  const findValue = (row: string[], keyAliases: string[]) => {
    const index = headers.findIndex((header) => keyAliases.includes(header));
    if (index === -1 || !row[index]) return '';
    return row[index].replace(/^"|"$/g, '').trim();
  };

  return leadRows
    .map((line) => splitCsvLine(line))
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const name = findValue(row, ['name', 'full_name', 'person', 'lead_name']);
      const institution = findValue(row, [
        'institution',
        'company',
        'organization',
        'university',
        'school',
        'employer',
      ]);
      const department = findValue(row, ['department', 'team', 'division', 'role', 'title']);
      const email = findValue(row, ['email', 'email_address', 'mail']);

      return createProspect(name || 'Unknown lead', institution || '', department || '', email || '');
    })
    .filter((lead) => lead.name !== 'Unknown lead' || lead.institution || lead.email);
};

const demoCampaigns: Campaign[] = [
  {
    id: 'camp-2024-1',
    name: 'AI Research Leads',
    status: 'Complete',
    createdAt: '2026-07-18T12:00:00.000Z',
    updatedAt: '2026-07-18T18:45:00.000Z',
    prospects: [
      createProspect('Ada Lovelace', 'University of London', 'Mathematics', 'ada@example.com'),
      createProspect('Grace Hopper', 'Vanderbilt University', 'Computer Science', 'grace@example.com'),
    ],
    results: [
      {
        id: 'result-1',
        prospectName: 'Ada Lovelace',
        score: 9.2,
        verdict: 'Strong',
        subject: 'A note on the future of AI research',
        body:
          'Hi Ada, I was struck by your work on analytical engines and the way you connect symbolic systems with real-world problem solving. I think there is a strong overlap between that work and our current AI research program. Would you be open to a quick conversation about how we might collaborate?',
        reason: 'Strong evidence of publication overlap and active AI work in current projects.',
      },
      {
        id: 'result-2',
        prospectName: 'Grace Hopper',
        score: 8.4,
        verdict: 'Moderate',
        subject: 'Exploring a research collaboration',
        body:
          'Hi Grace, I came across your recent work in programming language systems and the way you translate foundational research into usable tools. Our team is exploring similar problems in applied AI, and I would value your perspective.',
        reason: 'Good relevance and timeline, though the department match is slightly less direct.',
      },
    ],
  },
  {
    id: 'camp-2024-2',
    name: 'Applied ML Hiring',
    status: 'Queued',
    createdAt: '2026-07-21T10:15:00.000Z',
    updatedAt: '2026-07-22T09:05:00.000Z',
    prospects: [
      createProspect('Alan Turing', 'Princeton University', 'Logic & Computation', 'alan@example.com'),
      createProspect('Margaret Hamilton', 'MIT', 'Software Engineering', 'margaret@example.com'),
    ],
    results: [],
  },
];

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(demoCampaigns);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(demoCampaigns[0].id);
  const [campaignName, setCampaignName] = useState<string>('New campaign');
  const [prospects, setProspects] = useState<Prospect[]>([
    createProspect('Ada Lovelace', 'University of London', 'Mathematics', 'ada@example.com'),
  ]);
  const [activeResultId, setActiveResultId] = useState<string>(demoCampaigns[0].results[0]?.id ?? '');
  const [runState, setRunState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [backendReady, setBackendReady] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Health check failed');
        }

        const data = await response.json();
        setBackendReady(Boolean(data?.ok));
        setNotice('Connected to backend.');
      })
      .catch(() => {
        setBackendReady(false);
        setError('Backend is not running. Start the engine with npm run dev in the project root.');
      });
  }, []);

  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0];

  if (!selectedCampaign) {
    return null;
  }

  const activeResult =
    selectedCampaign.results.find((result) => result.id === activeResultId) ??
    selectedCampaign.results[0];

  const summary = useMemo(() => {
    const totalProspects = selectedCampaign.prospects.length;
    const totalResults = selectedCampaign.results.length;
    const avgScore =
      totalResults > 0
        ? selectedCampaign.results.reduce((sum, result) => sum + result.score, 0) / totalResults
        : 0;

    return { totalProspects, totalResults, avgScore };
  }, [selectedCampaign]);

  const updateProspect = (index: number, key: keyof Prospect, value: string) => {
    setProspects((current) =>
      current.map((prospect, prospectIndex) =>
        prospectIndex === index ? { ...prospect, [key]: value } : prospect,
      ),
    );
  };

  const addProspect = () => {
    setProspects((current) => [...current, createProspect()]);
  };

  const removeProspect = (index: number) => {
    setProspects((current) => current.filter((_, prospectIndex) => prospectIndex !== index));
  };

  const handleNewCampaign = (event: FormEvent) => {
    event.preventDefault();

    const trimmedName = campaignName.trim() || 'Untitled campaign';
    const newCampaign: Campaign = {
      id: `campaign-${Date.now()}`,
      name: trimmedName,
      status: 'Draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prospects: prospects.filter((prospect) => prospect.name.trim() || prospect.institution.trim()),
      results: [],
    };

    setCampaigns((current) => [newCampaign, ...current]);
    setSelectedCampaignId(newCampaign.id);
    setCampaignName('New campaign');
    setProspects([createProspect()]);
    setNotice(`Campaign “${trimmedName}” created.`);
    setError('');
    setRunState('success');
  };

  const handleCsvUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const csvString = String(reader.result ?? '');
      const parsed = parseCsvLeads(csvString);

      if (!parsed.length) {
        setError('CSV file is empty or missing a valid name/institution/email header.');
        setRunState('error');
        return;
      }

      setProspects(parsed);
      setCsvFileName(file.name);
      setNotice(`${parsed.length} leads loaded from ${file.name}.`);
      setError('');
      setRunState('success');
    };

    reader.onerror = () => {
      setError('Unable to read the chosen CSV file.');
      setRunState('error');
    };

    reader.readAsText(file);
    event.target.value = '';
  };

  const handleRunCampaign = async () => {
    setRunState('loading');
    setNotice('');
    setError('');

    try {
      const payload = {
        campaign_id: selectedCampaign.id,
        prospects: selectedCampaign.prospects.map((prospect) => ({
          prospect_id: prospect.id,
          campaign_id: selectedCampaign.id,
          name: prospect.name,
          institution: prospect.institution,
          department: prospect.department || undefined,
          email: prospect.email || undefined,
        })),
      };

      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? 'The campaign request was rejected.');
      }

      setCampaigns((current) =>
        current.map((campaign) =>
          campaign.id === selectedCampaign.id
            ? {
                ...campaign,
                status: 'Queued',
                updatedAt: new Date().toISOString(),
              }
            : campaign,
        ),
      );

      setNotice(
        `Campaign “${selectedCampaign.name}” accepted by backend: ${data.accepted ?? payload.prospects.length} leads queued.`,
      );
      setRunState('success');
      setError('');
    } catch (err) {
      setRunState('error');
      setError(err instanceof Error ? err.message : 'Unknown error occurred.');
    }
  };

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
            <button type="button" className="mini-button" onClick={() => setSelectedCampaignId('new')}>
              + New
            </button>
          </div>

          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className={`campaign-item ${campaign.id === selectedCampaignId ? 'active' : ''}`}
                onClick={() => setSelectedCampaignId(campaign.id)}
              >
                <div className="campaign-name-row">
                  <span>{campaign.name}</span>
                  <span className={`status-pill ${campaign.status.toLowerCase()}`}>{campaign.status}</span>
                </div>
                <small>
                  {campaign.results.length} results · {campaign.prospects.length} prospects
                </small>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow dark">Campaign dashboard</p>
            <h2>{selectedCampaign.name}</h2>
          </div>
          <div className="header-actions">
            <span className={`status-pill ${backendReady ? 'success' : 'weak'}`}>
              {backendReady ? 'Backend online' : 'Backend offline'}
            </span>
            <button type="button" className="primary-button" onClick={handleRunCampaign}>
              {runState === 'loading' ? 'Running…' : 'Run campaign'}
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card">
            <span>Prospects</span>
            <strong>{summary.totalProspects}</strong>
          </article>
          <article className="stat-card">
            <span>Results</span>
            <strong>{summary.totalResults}</strong>
          </article>
          <article className="stat-card">
            <span>Avg. score</span>
            <strong>{summary.avgScore > 0 ? summary.avgScore.toFixed(1) : '—'}</strong>
          </article>
          <article className="stat-card">
            <span>Updated</span>
            <strong>{formatDate(selectedCampaign.updatedAt)}</strong>
          </article>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h3>Prospect list</h3>
              <span>{selectedCampaign.prospects.length} people</span>
            </div>

            <div className="prospect-list">
              {selectedCampaign.prospects.map((prospect) => (
                <div key={prospect.id} className="prospect-row">
                  <div>
                    <strong>{prospect.name || 'Unnamed prospect'}</strong>
                    <small>
                      {prospect.institution || 'No institution'} · {prospect.department || 'No department'}
                    </small>
                  </div>
                  <span>{prospect.email || 'No email'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Result quality</h3>
              <span>{selectedCampaign.results.length} items</span>
            </div>

            <div className="results-table">
              <div className="table-header">
                <span>Prospect</span>
                <span>Score</span>
                <span>Verdict</span>
              </div>

              {selectedCampaign.results.length === 0 ? (
                <p className="empty-state">No results yet for this campaign.</p>
              ) : (
                selectedCampaign.results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className={`result-row ${activeResult?.id === result.id ? 'selected' : ''}`}
                    onClick={() => setActiveResultId(result.id)}
                  >
                    <span>{result.prospectName}</span>
                    <span>{result.score.toFixed(1)}</span>
                    <span className={`verdict ${result.verdict.toLowerCase()}`}>{result.verdict}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="detail-grid">
          <div className="panel compose-panel">
            <div className="panel-header">
              <h3>Create campaign</h3>
            </div>

            <form onSubmit={handleNewCampaign} className="composer-form">
              <label className="field">
                <span>Campaign name</span>
                <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
              </label>

              <div className="upload-box">
                <label htmlFor="csv-upload" className="upload-label">
                  Upload CSV leads
                </label>
                <input id="csv-upload" type="file" accept=".csv,text/csv" onChange={handleCsvUpload} />
                <small className="helper-text">
                  Expected headers: name, institution, department, email. CSV rows become prospect records for research.
                </small>
                {csvFileName ? <span className="csv-file-name">Loaded: {csvFileName}</span> : null}
              </div>

              {prospects.map((prospect, index) => (
                <div key={prospect.id} className="composer-row">
                  <input
                    value={prospect.name}
                    placeholder="Name"
                    onChange={(event) => updateProspect(index, 'name', event.target.value)}
                  />
                  <input
                    value={prospect.institution}
                    placeholder="Institution"
                    onChange={(event) => updateProspect(index, 'institution', event.target.value)}
                  />
                  <input
                    value={prospect.department}
                    placeholder="Department"
                    onChange={(event) => updateProspect(index, 'department', event.target.value)}
                  />
                  <button type="button" className="ghost-button" onClick={() => removeProspect(index)}>
                    Remove
                  </button>
                </div>
              ))}

              <div className="composer-actions">
                <button type="button" className="secondary-button" onClick={addProspect}>
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
              <span>{activeResult ? activeResult.verdict : 'No result selected'}</span>
            </div>

            {activeResult ? (
              <div className="preview-card">
                <p className="preview-label">Subject</p>
                <h4>{activeResult.subject}</h4>
                <p className="preview-label">Score</p>
                <strong className="score-pill">{activeResult.score.toFixed(1)}/10</strong>
                <p className="preview-label">Reasoning</p>
                <p>{activeResult.reason}</p>
                <p className="preview-label">Body</p>
                <p className="body-copy">{activeResult.body}</p>
              </div>
            ) : (
              <p className="empty-state">Select a result to inspect the email.</p>
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
