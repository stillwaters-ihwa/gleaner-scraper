// "Check before filing": mechanical checks of a PDF against the file rules of mints, the Japanese
// courts' e-filing system (民事裁判書類電子提出システム), as written in its user manual
// (操作マニュアル 当事者ユーザ編 2.2版, 2026-05-16). Advisory only: it never says a file will be accepted.

export interface PdfFacts {
  name: string;
  bytes: number;
  encrypted: boolean;
  /** Page sizes in points, as displayed (after rotation). */
  pages: { w: number; h: number }[];
  hasJavaScript: boolean;
  hasAttachments: boolean;
  /** The file is a redacted copy (made with black-out). */
  masked?: boolean;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';
export interface Check {
  id: string;
  status: CheckStatus;
  label: string;
  labelJa: string;
  detail: string;
  detailJa: string;
  /** Where the rule comes from. */
  source: string;
}

const MANUAL = 'mints 操作マニュアル～当事者ユーザ編～ 2.2版';
const MB = 1024 * 1024;
// A4 595.28 × 841.89 pt, A3 841.89 × 1190.55 pt (either way up); a little slack for rounding
const SIZES = [
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A3', w: 841.89, h: 1190.55 },
];
const TOL = 3;

export function paperOf(p: { w: number; h: number }): string | null {
  for (const s of SIZES) {
    if ((Math.abs(p.w - s.w) <= TOL && Math.abs(p.h - s.h) <= TOL) || (Math.abs(p.w - s.h) <= TOL && Math.abs(p.h - s.w) <= TOL)) return s.name;
  }
  return null;
}

/** Characters that commonly fail: Windows-forbidden ones, controls, emoji and other symbols outside JIS X 0213. */
export function oddNameChars(name: string): string[] {
  const bad = new Set<string>();
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (/[\\/:*?"<>|]/.test(ch) || c < 0x20 || c === 0x7f) bad.add(ch);
    // Emoji and pictographs, variation selectors, zero-width joiners
    else if ((c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0x200d || c === 0x20e3) bad.add(ch);
    // Letters from scripts JIS X 0213 doesn't cover (Hangul, Thai, Arabic, Hebrew, Devanagari...)
    else if ((c >= 0xac00 && c <= 0xd7af) || (c >= 0x0e00 && c <= 0x0e7f) || (c >= 0x0600 && c <= 0x06ff) || (c >= 0x0590 && c <= 0x05ff) || (c >= 0x0900 && c <= 0x097f)) bad.add(ch);
  }
  return [...bad];
}

export function preflight(f: PdfFacts): Check[] {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  const nameLen = [...f.name].length;

  add(
    f.encrypted
      ? { id: 'password', status: 'fail', label: 'Password or encryption', labelJa: 'パスワード・暗号化', detail: 'The PDF is password-protected or encrypted. mints does not accept files with passwords; remove it and save again.', detailJa: 'パスワード（暗号化）が設定されています。パスワード付きのファイルはアップロードできません。解除して保存し直してください。', source: `${MANUAL} p.65, message 45` }
      : { id: 'password', status: 'pass', label: 'Password or encryption', labelJa: 'パスワード・暗号化', detail: 'No password or encryption.', detailJa: 'パスワード・暗号化はありません。', source: `${MANUAL} p.65` },
  );

  const wrong = f.pages.map((p, i) => ({ i: i + 1, p, paper: paperOf(p) })).filter((x) => !x.paper);
  const papers = [...new Set(f.pages.map(paperOf).filter(Boolean))];
  add(
    !f.pages.length
      ? { id: 'paper', status: 'fail', label: 'Paper size', labelJa: '用紙サイズ', detail: 'The PDF has no pages.', detailJa: 'ページがありません。', source: `${MANUAL} p.66` }
      : wrong.length
        ? { id: 'paper', status: 'fail', label: 'Paper size', labelJa: '用紙サイズ', detail: `${wrong.length} of ${f.pages.length} pages are not A4 or A3 (page ${wrong.slice(0, 5).map((w) => `${w.i}: ${Math.round((w.p.w / 72) * 25.4)}×${Math.round((w.p.h / 72) * 25.4)} mm`).join(', ')}). Formal filings must be A4, A3, or both.`, detailJa: `${f.pages.length}ページ中${wrong.length}ページがA4・A3以外です（${wrong.slice(0, 5).map((w) => `${w.i}ページ目 ${Math.round((w.p.w / 72) * 25.4)}×${Math.round((w.p.h / 72) * 25.4)}mm`).join('、')}）。主張・証拠などはA3、A4又はA3とA4が混在するPDFで提出します。`, source: `${MANUAL} p.66, message 46` }
        : { id: 'paper', status: 'pass', label: 'Paper size', labelJa: '用紙サイズ', detail: `All ${f.pages.length} pages are ${papers.join(' and ')}.`, detailJa: `全${f.pages.length}ページが${papers.join('・')}です。`, source: `${MANUAL} p.66` },
  );

  add(
    f.bytes > 200 * MB
      ? { id: 'size', status: 'fail', label: 'File size', labelJa: 'ファイル容量', detail: `${(f.bytes / MB).toFixed(1)} MB. One upload can be at most 200 MB in total; split the file.`, detailJa: `${(f.bytes / MB).toFixed(1)}MBです。1回にアップロードできる最大容量は合計200MBまでです。分割してください。`, source: `${MANUAL} p.65–66` }
      : { id: 'size', status: f.bytes > 150 * MB ? 'warn' : 'pass', label: 'File size', labelJa: 'ファイル容量', detail: `${(f.bytes / MB).toFixed(1)} MB${f.bytes > 150 * MB ? '. Under the 200 MB limit, but files uploaded together count toward the same 200 MB.' : ' (limit 200 MB per upload).'}`, detailJa: `${(f.bytes / MB).toFixed(1)}MB${f.bytes > 150 * MB ? '。200MB以内ですが、同時にアップロードするファイルの合計で200MBまでです。' : '（1回の上限は合計200MB）。'}`, source: `${MANUAL} p.65–66` },
  );

  add(
    nameLen > 100
      ? { id: 'name-length', status: 'fail', label: 'File name length', labelJa: 'ファイル名の文字数', detail: `${nameLen} characters. File names may have at most 100, including ".pdf".`, detailJa: `${nameLen}文字です。ファイル名は拡張子を含め最大100文字までです。`, source: `${MANUAL} p.6, p.65, message 53` }
      : { id: 'name-length', status: 'pass', label: 'File name length', labelJa: 'ファイル名の文字数', detail: `${nameLen} of 100 characters.`, detailJa: `${nameLen}文字（上限100文字）。`, source: `${MANUAL} p.6` },
  );

  const odd = oddNameChars(f.name);
  add(
    odd.length
      ? { id: 'name-chars', status: 'warn', label: 'File name characters', labelJa: 'ファイル名の文字', detail: `These may not be accepted: ${odd.map((c) => `"${c}"`).join(' ')}. mints uses characters from JIS X 0213.`, detailJa: `使用できない可能性のある文字: ${odd.map((c) => `「${c}」`).join(' ')}。本システムで使用できる文字はJIS X 0213の文字が基本です。`, source: `${MANUAL} p.6` }
      : { id: 'name-chars', status: 'pass', label: 'File name characters', labelJa: 'ファイル名の文字', detail: 'No characters known to cause trouble.', detailJa: '問題になりやすい文字はありません。', source: `${MANUAL} p.6` },
  );

  if (!/\.pdf$/i.test(f.name)) add({ id: 'extension', status: 'fail', label: 'File type', labelJa: 'ファイル形式', detail: 'The name should end in .pdf.', detailJa: 'ファイル名の末尾を「.pdf」にしてください。', source: `${MANUAL} p.66` });

  if (f.masked)
    add(
      f.name.startsWith('（マスキング）')
        ? { id: 'masking', status: 'pass', label: 'Masked copy name', labelJa: 'マスキング文書の名前', detail: 'The name starts with （マスキング）.', detailJa: 'ファイル名の冒頭に（マスキング）があります。', source: 'courts.go.jp: mintsの利用に関する注意点２' }
        : { id: 'masking', status: 'info', label: 'Masked copy name', labelJa: 'マスキング文書の名前', detail: 'This copy has blacked-out parts. When filing it with a request to restrict access (閲覧制限), the court asks that the name start with （マスキング）.', detailJa: '黒塗りがあります。閲覧制限の申立てで提出する場合は、ファイル名の冒頭に「（マスキング）」と表示してください。', source: 'courts.go.jp: mintsの利用に関する注意点２' },
    );

  // Not mints rules, but things that often cause trouble with court systems
  if (f.hasJavaScript) add({ id: 'javascript', status: 'warn', label: 'Scripts inside the PDF', labelJa: 'PDF内のスクリプト', detail: 'The PDF contains JavaScript. Not a written mints rule, but court systems often reject or strip it; re-save without it.', detailJa: 'JavaScriptが含まれています。mintsの明文の要件ではありませんが、問題になりやすいため、除いて保存し直すことをおすすめします。', source: 'General advice' });
  if (f.hasAttachments) add({ id: 'attachments', status: 'warn', label: 'Files attached inside the PDF', labelJa: 'PDF内の添付ファイル', detail: 'The PDF has files attached inside it, which may not be seen by the court. Submit them as separate files.', detailJa: 'PDF内に添付ファイルがあります。裁判所で確認されない可能性があるため、別ファイルとして提出してください。', source: 'General advice' });
  return out;
}

const latin = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** Reads the facts the checks need from a PDF. `pdfjs` is pdf.js (the browser or Node build). */
export async function pdfFacts(pdfjs: any, data: Uint8Array, name: string, masked?: boolean): Promise<PdfFacts> {
  const raw = latin(data.subarray(0, Math.min(data.length, 64 * MB)));
  const tail = latin(data.subarray(Math.max(0, data.length - 4096)));
  let encrypted = /\/Encrypt\s/.test(tail) || /\/Encrypt\s*\d+\s+\d+\s+R/.test(raw);
  const pages: { w: number; h: number }[] = [];
  try {
    const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, stopAtErrors: false }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const v = (await doc.getPage(i)).getViewport({ scale: 1 });
      pages.push({ w: v.width, h: v.height });
    }
    await doc.destroy();
  } catch (e) {
    if ((e as any)?.name === 'PasswordException') encrypted = true;
  }
  return {
    name,
    bytes: data.length,
    encrypted,
    pages,
    hasJavaScript: /\/(JavaScript|JS)\s*[(<\[/]/.test(raw),
    hasAttachments: /\/EmbeddedFiles\b/.test(raw),
    masked,
  };
}

export function preflightMarkdown(checks: Check[], fileName: string, ja = false): string {
  const icon = { pass: 'OK', fail: 'NG', warn: '要確認', info: '参考' } as const;
  const iconEn = { pass: 'Pass', fail: 'Fail', warn: 'Check', info: 'Note' } as const;
  const L = ja
    ? [`# 提出前チェック: ${fileName}`, '', 'mints（民事裁判書類電子提出システム）の操作マニュアルに記載されたファイル要件を機械的に確認した結果です。提出できることを保証するものではありません。', '']
    : [`# Check before filing: ${fileName}`, '', 'A mechanical check against the file rules in the mints user manual. It does not guarantee the court will accept the file.', ''];
  for (const c of checks) L.push(`- **${ja ? icon[c.status] : iconEn[c.status]}** ${ja ? c.labelJa : c.label}: ${ja ? c.detailJa : c.detail} _(${c.source})_`);
  return L.join('\n') + '\n';
}
