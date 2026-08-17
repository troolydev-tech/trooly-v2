import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';

import { supabase } from './lib/supabase';

type Sourced = { value: string; source_url: string; source_quote: string };

type Product = {
  id?: string;
  name: string;
  // Legacy plain-text fields (used by manual "Add product" entry)
  description: string;
  capabilities: string;
  use_cases: string;
  technical_specs: string;
  // New sourced fields — arrays from the analyzer, editable by user
  description_sourced?: Sourced | null;
  capabilities_sourced?: Sourced[] | null;
  use_cases_sourced?: Sourced[] | null;
  technical_specs_sourced?: Sourced[] | null;
};

type Company = {
  id: string;
  company_name: string;
  website: string | null;
  summary: string | null;
  created_at: string;
};

type UploadedFile = { filename: string; text: string };
type Mode = 'empty' | 'new' | 'edit';

const emptyProduct = (): Product => ({
  name: '', description: '', capabilities: '', use_cases: '', technical_specs: '',
});

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mode, setMode] = useState<Mode>('empty');
  const [selectedId, setSelectedId] = useState<string>('');

  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [summary, setSummary] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  // Store the sourced version of the summary when analyzer runs
  const [analysisSummarySourced, setAnalysisSummarySourced] = useState<Sourced | null>(null);

  // Which product card index is currently open in edit mode? null = none.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState<Product>(emptyProduct());

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // ─── Data loading ─────────────────────────────────────────────
  const loadCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { setError(`Failed to load: ${error.message}`); return; }
    setCompanies(data ?? []);
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  const loadCompanyDetails = useCallback(async (id: string) => {
    const { data: c } = await supabase.from('companies').select('*').eq('id', id).single();
    if (!c) return;
    setCompanyName(c.company_name);
    setWebsite(c.website ?? '');
    setSummary(c.summary ?? '');
    setAnalysisSummarySourced((c as { summary_sourced?: Sourced | null }).summary_sourced ?? null);

    const { data: prods } = await supabase.from('products').select('*').eq('company_id', id);
    setProducts((prods ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? '',
      description: p.description ?? '',
      capabilities: p.capabilities ?? '',
      use_cases: p.use_cases ?? '',
      technical_specs: p.technical_specs ?? '',
      description_sourced: p.description_sourced ?? null,
      capabilities_sourced: p.capabilities_sourced ?? null,
      use_cases_sourced: p.use_cases_sourced ?? null,
      technical_specs_sourced: p.technical_specs_sourced ?? null,
    })));
  }, []);

  // ─── Navigation ───────────────────────────────────────────────
  const startNew = () => {
    setMode('new'); setSelectedId('');
    setCompanyName(''); setWebsite(''); setSummary('');
    setProducts([]); setUploadedFiles([]);
    setAnalysisSummarySourced(null);
    setEditingIndex(null);
    setNotice(''); setError('');
  };

  const selectCompany = async (id: string) => {
    setMode('edit'); setSelectedId(id);
    setUploadedFiles([]); setEditingIndex(null);
    setNotice(''); setError('');
    await loadCompanyDetails(id);
  };

  // ─── File uploads ─────────────────────────────────────────────
  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const parsed: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text().catch(() => '');
      if (text.length > 100) parsed.push({ filename: file.name, text });
    }
    setUploadedFiles((c) => [...c, ...parsed]);
    setNotice(`${parsed.length} file(s) added. Click "Analyze" to extract from them.`);
    event.target.value = '';
  };

  // ─── Product card actions ─────────────────────────────────────
  const startEditingProduct = (index: number) => {
    setEditBuffer({ ...products[index] });
    setEditingIndex(index);
  };

  const cancelEditingProduct = () => {
    setEditingIndex(null);
    setEditBuffer(emptyProduct());
    if (editingIndex !== null) {
      const p = products[editingIndex];
      if (p && !p.id && !p.name.trim() && !p.description.trim()) {
        setProducts((c) => c.filter((_, i) => i !== editingIndex));
      }
    }
  };

  const saveEditingProduct = () => {
    if (editingIndex === null) return;
    setProducts((current) =>
      current.map((p, i) => (i === editingIndex ? editBuffer : p)),
    );
    setEditingIndex(null);
    setEditBuffer(emptyProduct());
  };

  const removeProduct = (index: number) => {
    const p = products[index];
    if (!window.confirm(`Remove product "${p?.name || 'this'}"? (Save changes to persist.)`)) return;
    setProducts((c) => c.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditBuffer(emptyProduct());
    }
  };

  const addBlankProduct = () => {
    const newIndex = products.length;
    setProducts((c) => [...c, emptyProduct()]);
    setEditBuffer(emptyProduct());
    setEditingIndex(newIndex);
  };

  const updateEditBuffer = (key: keyof Product, value: string) => {
    setEditBuffer((b) => ({ ...b, [key]: value }));
  };

  // ─── Analyze ──────────────────────────────────────────────────
  const handleAnalyze = async () => {
    setError(''); setNotice('');
    if (!companyName.trim() || !website.trim()) {
      setError('Company name and website are required.');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/analyze-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(),
          website: website.trim(),
          uploaded_files: uploadedFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Analysis failed');

      type AnalyzerProduct = {
        name: string;
        description: Sourced;
        capabilities: Sourced[];
        use_cases: Sourced[];
        technical_specs: Sourced[];
      };
      type AnalyzerResponse = {
        company_summary: Sourced;
        products: AnalyzerProduct[];
        cost_usd: number;
      };
      const typed = data as AnalyzerResponse;

      setSummary(typed.company_summary.value);
      setAnalysisSummarySourced(typed.company_summary);

      const existingNames = new Set(products.map((p) => p.name.toLowerCase()));
      const newProducts: Product[] = typed.products
        .filter((p) => !existingNames.has(p.name.toLowerCase()))
        .map((p) => ({
          name: p.name,
          description: p.description.value,
          capabilities: p.capabilities.map((c) => c.value).join('; '),
          use_cases: p.use_cases.map((c) => c.value).join('; '),
          technical_specs: p.technical_specs.map((c) => c.value).join('; '),
          description_sourced: p.description,
          capabilities_sourced: p.capabilities,
          use_cases_sourced: p.use_cases,
          technical_specs_sourced: p.technical_specs,
        }));

      setProducts((current) => [...current, ...newProducts]);
      setUploadedFiles([]);
      setNotice(
        `Analysis complete. ${typed.products.length} products found, ` +
        `${newProducts.length} new. Cost: $${typed.cost_usd.toFixed(4)}. Review, then click Save.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  // ─── Save / Delete company ────────────────────────────────────
  const handleSave = async () => {
    if (!companyName.trim() || !website.trim()) {
      setError('Company name and website are required.');
      return;
    }
    if (editingIndex !== null) {
      setError('Finish editing the open product first.');
      return;
    }
    setSaving(true); setError(''); setNotice('');

    try {
      let companyId = selectedId;

      if (mode === 'new') {
        const { data, error: cErr } = await supabase.from('companies').insert({
          company_name: companyName.trim(),
          website: website.trim(),
          summary,
          summary_sourced: analysisSummarySourced ?? null,
        }).select().single();
        if (cErr || !data) throw new Error(cErr?.message ?? 'Failed to create company');
        companyId = data.id;
      } else {
        const { error: cErr } = await supabase.from('companies').update({
          company_name: companyName.trim(),
          website: website.trim(),
          summary,
          summary_sourced: analysisSummarySourced ?? null,
        }).eq('id', companyId);
        if (cErr) throw new Error(cErr.message);
      }

      // Handle deleted products
      if (mode === 'edit') {
        const { data: currentServer } = await supabase.from('products').select('id').eq('company_id', companyId);
        const localIds = new Set(products.filter((p) => p.id).map((p) => p.id!));
        const toDelete = (currentServer ?? [])
          .map((r) => r.id)
          .filter((id) => !localIds.has(id));
        if (toDelete.length > 0) {
          await supabase.from('products').delete().in('id', toDelete);
        }
      }

      const existing = products.filter((p) => p.id);
      const brandNew = products.filter((p) => !p.id && p.name.trim());

      for (const p of existing) {
        await supabase.from('products').update({
          name: p.name,
          description: p.description,
          capabilities: p.capabilities,
          use_cases: p.use_cases,
          technical_specs: p.technical_specs,
          description_sourced: p.description_sourced ?? null,
          capabilities_sourced: p.capabilities_sourced ?? null,
          use_cases_sourced: p.use_cases_sourced ?? null,
          technical_specs_sourced: p.technical_specs_sourced ?? null,
        }).eq('id', p.id!);
      }

      if (brandNew.length > 0) {
        const rows = brandNew.map((p) => ({
          company_id: companyId,
          name: p.name,
          description: p.description,
          capabilities: p.capabilities,
          use_cases: p.use_cases,
          technical_specs: p.technical_specs,
          description_sourced: p.description_sourced ?? null,
          capabilities_sourced: p.capabilities_sourced ?? null,
          use_cases_sourced: p.use_cases_sourced ?? null,
          technical_specs_sourced: p.technical_specs_sourced ?? null,
        }));
        await supabase.from('products').insert(rows);
      }

      setNotice(
        mode === 'new'
          ? `Company "${companyName}" created with ${products.length} products.`
          : `Saved changes to "${companyName}" (${products.length} products).`,
      );
      await loadCompanies();
      if (mode === 'new') {
        setMode('edit');
        setSelectedId(companyId);
        await loadCompanyDetails(companyId);
      } else {
        await loadCompanyDetails(companyId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (mode !== 'edit' || !selectedId) return;
    if (!window.confirm(`Delete "${companyName}" and all its products?`)) return;
    setSaving(true);
    try {
      await supabase.from('products').delete().eq('company_id', selectedId);
      await supabase.from('companies').delete().eq('id', selectedId);
      setNotice(`Deleted "${companyName}".`);
      setMode('empty'); setSelectedId('');
      setCompanyName(''); setWebsite(''); setSummary(''); setProducts([]);
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ─── Small helper: render a value with a source tooltip if we have one
  const SourceTip = ({ items }: { items: Sourced[] | null | undefined }) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="source-tips">
        {items.map((item, i) => (
          <details key={i} className="source-tip">
            <summary>Source {i + 1}: {new URL(item.source_url.startsWith('file:') ? 'https://placeholder.local' : item.source_url).hostname}</summary>
            <div className="source-quote">"{item.source_quote}"</div>
            {!item.source_url.startsWith('file:') && (
              <a href={item.source_url} target="_blank" rel="noopener noreferrer">Open source ↗</a>
            )}
          </details>
        ))}
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="layout-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Trooly</p>
          <h1>Companies</h1>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <span>Saved companies</span>
            <button type="button" className="mini-button" onClick={startNew}>+ New</button>
          </div>
          <div className="campaign-list">
            {companies.length === 0 ? (
              <p className="empty-state">No companies yet. Click "+ New" to add one.</p>
            ) : (
              companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`campaign-item ${c.id === selectedId ? 'active' : ''}`}
                  onClick={() => selectCompany(c.id)}
                >
                  <div className="campaign-name-row"><span>{c.company_name}</span></div>
                  <small>{c.website ?? 'No website'}</small>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        {mode === 'empty' && (
          <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.7 }}>
            <h2>Select a company from the sidebar</h2>
            <p>Or click "+ New" to add one.</p>
          </div>
        )}

        {(mode === 'new' || mode === 'edit') && (
          <>
            <header className="workspace-header">
              <div>
                <p className="eyebrow dark">{mode === 'new' ? 'New company' : 'Edit company'}</p>
                <h2>{companyName || 'Untitled company'}</h2>
              </div>
              <div className="header-actions">
                {mode === 'edit' && (
                  <button type="button" className="ghost-button" onClick={handleDelete} disabled={saving}>
                    Delete
                  </button>
                )}
                <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : (mode === 'new' ? 'Save company' : 'Save changes')}
                </button>
              </div>
            </header>

            <section className="panel" style={{ marginTop: '1rem' }}>
              <div className="panel-header"><h3>Company details</h3></div>
              <div className="composer-form">
                <label className="field">
                  <span>Company name</span>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </label>
                <label className="field">
                  <span>Website</span>
                  <input value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
                <label className="field">
                  <span>Company summary</span>
                  <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
                  {analysisSummarySourced && (
                    <SourceTip items={[analysisSummarySourced]} />
                  )}
                </label>
              </div>
            </section>

            <section className="panel" style={{ marginTop: '1rem' }}>
              <div className="panel-header">
                <h3>Enrich data</h3>
                <span>Scrape website or add brochures to extract more products</span>
              </div>
              <div className="composer-form">
                <div className="upload-box">
                  <label htmlFor="brochure-upload" className="upload-label">Upload brochures / catalogs</label>
                  <input id="brochure-upload" type="file" multiple accept=".txt,.md" onChange={handleFileUpload} />
                  <small className="helper-text">
                    Text/markdown files supported. PDF/DOC parsing coming soon.
                  </small>
                  {uploadedFiles.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {uploadedFiles.map((f, i) => (
                        <div key={i} style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                          {f.filename} ({(f.text.length / 1000).toFixed(1)}k chars)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="composer-actions">
                  <button type="button" className="secondary-button" onClick={handleAnalyze}
                    disabled={analyzing || !companyName || !website}>
                    {analyzing ? 'Analyzing…' : 'Analyze website + files'}
                  </button>
                </div>
              </div>
            </section>

            <section className="panel" style={{ marginTop: '1rem' }}>
              <div className="panel-header">
                <h3>Products</h3>
                <span>{products.length} items</span>
              </div>

              {products.length === 0 && (
                <p className="empty-state" style={{ padding: '1rem' }}>
                  No products yet. Run analysis, or add one manually.
                </p>
              )}

              <div className="product-grid">
                {products.map((p, i) => (
                  editingIndex === i ? (
                    <div key={p.id ?? `new-${i}`} className="product-card editing">
                      <label className="field">
                        <span>Name</span>
                        <input value={editBuffer.name}
                          onChange={(e) => updateEditBuffer('name', e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Description</span>
                        <textarea rows={3} value={editBuffer.description}
                          onChange={(e) => updateEditBuffer('description', e.target.value)} />
                        <SourceTip items={editBuffer.description_sourced ? [editBuffer.description_sourced] : null} />
                      </label>
                      <label className="field">
                        <span>Capabilities</span>
                        <textarea rows={3} value={editBuffer.capabilities}
                          onChange={(e) => updateEditBuffer('capabilities', e.target.value)} />
                        <SourceTip items={editBuffer.capabilities_sourced} />
                      </label>
                      <label className="field">
                        <span>Use cases</span>
                        <textarea rows={3} value={editBuffer.use_cases}
                          onChange={(e) => updateEditBuffer('use_cases', e.target.value)} />
                        <SourceTip items={editBuffer.use_cases_sourced} />
                      </label>
                      <label className="field">
                        <span>Technical specs</span>
                        <textarea rows={3} value={editBuffer.technical_specs}
                          onChange={(e) => updateEditBuffer('technical_specs', e.target.value)} />
                        <SourceTip items={editBuffer.technical_specs_sourced} />
                      </label>
                      <div className="product-card-actions">
                        <button type="button" className="ghost-button" onClick={cancelEditingProduct}>Cancel</button>
                        <button type="button" className="primary-button" onClick={saveEditingProduct}>Done</button>
                      </div>
                    </div>
                  ) : (
                    <div key={p.id ?? `new-${i}`} className="product-card">
                      <div className="product-card-header">
                        <strong>{p.name || 'Untitled'}</strong>
                      </div>
                      <p className="product-card-desc">
                        {p.description || <span style={{ opacity: 0.5 }}>No description</span>}
                      </p>
                      {(p.capabilities_sourced || p.description_sourced) && (
                        <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '0.5rem' }}>
                          ✓ {((p.description_sourced ? 1 : 0) + (p.capabilities_sourced?.length ?? 0) + (p.use_cases_sourced?.length ?? 0) + (p.technical_specs_sourced?.length ?? 0))} sourced claims
                        </div>
                      )}
                      <div className="product-card-actions">
                        <button type="button" className="ghost-button" onClick={() => removeProduct(i)}>Delete</button>
                        <button type="button" className="secondary-button" onClick={() => startEditingProduct(i)}>Edit</button>
                      </div>
                    </div>
                  )
                ))}
              </div>

              <div className="composer-actions" style={{ padding: '1rem' }}>
                <button type="button" className="secondary-button" onClick={addBlankProduct}
                  disabled={editingIndex !== null}>
                  + Add product manually
                </button>
              </div>
            </section>
          </>
        )}

        {(notice || error) && (
          <div className={`alert ${error ? 'error' : 'success'}`}>{error || notice}</div>
        )}
      </main>
    </div>
  );
}