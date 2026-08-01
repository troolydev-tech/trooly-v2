/**
 * Jina.ai reader. Free, no key. Turns any URL into clean markdown.
 * Same thing you were using in n8n, just callable and with a timeout that actually works.
 */
export async function readUrl(url: string, timeoutMs = 20000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 30000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
