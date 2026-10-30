// A fetched page's text in its own character set. fetch's text() always reads UTF-8, which garbles
// Korean (EUC-KR), Japanese (Shift_JIS) and Chinese (GBK) sites that still use older encodings.

/** The charset a page declares: in its Content-Type header, else in a <meta> tag near the top. */
export function declaredCharset(contentType: string, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

/** Response body as text, decoded with the page's declared charset. */
export async function responseText(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const charset = declaredCharset(res.headers.get('content-type') ?? '', head);
  if (charset === 'utf-8' || charset === 'utf8') return new TextDecoder('utf-8').decode(buf);
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}
