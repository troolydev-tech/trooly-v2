/**
 * Jina.ai reader. Free, no key. Turns any URL into clean markdown by default.
 * Optional html mode for when we need to extract real links.
 */
export async function readUrl(
  url: string,
  opts: { format?: 'markdown' | 'html'; timeoutMs?: number } = {},
): Promise<string | null> {
  const format = opts.format ?? 'markdown';
  const timeoutMs = opts.timeoutMs ?? 20000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (format === 'html') headers['X-Return-Format'] = 'html';
    // Ask Jina to include the navigation/links (the "with-links-summary" hint)
    headers['X-With-Links-Summary'] = 'true';

    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 60000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}