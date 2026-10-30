// Keeping a capture as a record: the untouched original kept apart from the edited copy, the
// edit history, a capture report for people and for software, SHA-256 fingerprints of every file,
// and (optionally) an MHTML copy of the page, an evidence list, and a trusted timestamp.
import type { CaptureReport } from './shot';
import type { Crop, Edit } from './render';
import { sha256, sha256Sums, type FileMap } from './formats';

export interface HistoryEntry {
  at: string;
  action: string;
  detail?: string;
}

export interface EvidenceInfo {
  /** "Exhibit 3", "甲第3号証", "Ex. A-2"... */
  number: string;
  title: string;
  createdOn: string;
  author: string;
  purpose: string;
  notes: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const off = -d.getTimezoneOffset();
  const tz = `UTC${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  return `${d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'medium' })} (${tz}); ${d.toISOString()}`;
};

/** The lines Gleaner stamps on pictures and PDF pages. */
export function stampLines(r: CaptureReport): string[] {
  // A PDF from a file has no web address; its pages get the exhibit label and numbers instead
  if (r.mode === 'pdf file') return [];
  return [`${r.url}`, `Captured ${when(r.capturedAt)}${r.mode === 'full page' ? (r.stoppedEarly ? ' · stopped before the end of the page' : r.reachedBottom ? ' · whole page' : '') : ' · visible area'}`];
}

function reportMarkdown(r: CaptureReport, files: { path: string; sha: string; bytes: number; role: string }[], edits: Edit[], crop: Crop | null, evidence?: EvidenceInfo) {
  const L = [`# Capture report`, '', `| | |`, `|---|---|`];
  if (r.mode === 'pdf file' && r.source) {
    const mm = (pt: number) => Math.round((pt / 72) * 25.4);
    const sizes = [...new Set(r.source.pages.map((p) => `${mm(p.w)}×${mm(p.h)} mm`))];
    L.push(`| Source file | ${r.source.name.replace(/\|/g, '/')} |`, `| Opened | ${when(r.capturedAt)} |`, `| Source size | ${r.source.bytes.toLocaleString()} bytes |`, `| Source SHA-256 | \`${r.source.sha256}\` |`, `| Pages | ${r.source.pages.length} (${sizes.join(', ')}) |`, `| Drawn at | ${Math.round(r.devicePixelRatio * 72)} dpi for editing |`);
  } else {
    L.push(`| Page | ${r.title.replace(/\|/g, '/')} |`, `| Address | ${r.url} |`, `| Captured | ${when(r.capturedAt)} |`, `| What | ${r.mode === 'full page' ? 'The whole page' : 'The visible area'} (${r.pageSize.width}×${r.pageSize.height} CSS pixels, at ${r.devicePixelRatio}× pixel density) |`, `| Window | ${r.viewport.width}×${r.viewport.height} |`);
  }
  if (r.mode === 'full page') {
    L.push(`| Loading | Scrolled the ${r.scrolled === 'inner panel' ? 'inner panel' : 'page'} ${r.scrollSteps} times over ${r.loadSeconds}s so lazy content loaded |`);
    L.push(`| End of page | ${r.reachedBottom ? 'Reached and confirmed' : r.stoppedEarly ? 'Stopped early on request or time limit; content below may be missing' : 'Not confirmed'} |`);
  }
  if (r.parts.length > 1) L.push(`| Split | ${r.parts.length} pictures, each overlapping the previous by ${r.parts[1].overlapPx}px |`);
  L.push(`| Browser | ${r.userAgent} |`, `| Made with | Gleaner (browser extension); saved only on this computer |`);
  if (evidence) L.push(`| Exhibit | ${evidence.number}: ${evidence.title} |`);
  L.push('', '## Files', '', '| File | What it is | SHA-256 | Bytes |', '|---|---|---|---|');
  for (const f of files) L.push(`| ${f.path} | ${f.role} | \`${f.sha}\` | ${f.bytes.toLocaleString()} |`);
  L.push('', '## Edits', '');
  if (!edits.length && !crop) L.push('None. The edited copy is identical to the original.');
  else {
    if (crop) L.push(`- Cropped to ${Math.round(crop.w)}×${Math.round(crop.h)} starting at ${Math.round(crop.x)},${Math.round(crop.y)}`);
    const counts = edits.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
    for (const [k, n] of Object.entries(counts)) L.push(`- ${n} × ${k === 'blackout' ? 'blacked out (solid)' : k}`);
    L.push('', 'Every edit with its position is listed in history.json.');
  }
  L.push('', 'Check the files: `sha256sum -c SHA256SUMS.txt` (Linux/macOS) or `Get-FileHash -Algorithm SHA256 <file>` (Windows PowerShell).');
  return L.join('\n') + '\n';
}

const README = (hasOriginal: boolean, hasMhtml: boolean, evidence: boolean, pdf?: { name?: string; checked: boolean }) => `# Read this first

This ZIP is a record of ${pdf ? 'a PDF finished' : 'a web page capture made'} with Gleaner.
${pdf?.name ? `\n- **${pdf.name}** — the finished PDF, ready to upload.\n` : ''}${pdf?.checked ? '- **check-before-filing.md / .json** — the check against the mints file rules (advice only, not a promise the court accepts it).\n' : ''}

- **report.md** — what was captured, when, how, and a fingerprint (SHA-256) of every file. **report.json** has the same for software.
${hasOriginal ? (pdf ? '- **original/source.pdf** — the PDF exactly as opened, untouched.\n' : '- **original/** — the pictures exactly as captured, untouched.\n') : ''}- **edited/** — the copy with your crop, redactions and notes${hasOriginal ? '' : ' (the original is not included in this ZIP)'}.
${hasMhtml ? '- **page.mhtml** — the page itself as the browser saved it (open it in Edge or Chrome).\n' : ''}${evidence ? '- **evidence-list.csv / .json** — a draft evidence list for this exhibit.\n- **timestamp-hash.txt** — the fingerprint to send to a timestamp authority, if you add one.\n' : ''}- **history.json** — every edit, in order.
- **SHA256SUMS.txt** — fingerprints in the standard format, to check nothing changed.

${hasOriginal ? '**This ZIP contains the unedited original.** If you blacked out personal or confidential details, share the edited files (or a separate submission ZIP) instead of this one.\n' : ''}`.replace(/ — /g, ': ');

export interface RecordInput {
  report: CaptureReport;
  originals: Blob[];
  edited: Blob[];
  pdf?: Blob;
  mhtml?: string;
  edits: Edit[];
  crop: Crop | null;
  history: HistoryEntry[];
  /** Leave out the untouched original (for a redacted copy to hand to others). */
  withoutOriginal?: boolean;
  evidence?: EvidenceInfo;
  /** For a PDF opened in the Studio: the original file. */
  sourcePdf?: Blob;
  /** Name for the finished PDF, ready to upload (e.g. "甲第1号証 料金ページ.pdf"); placed at the top of the ZIP. */
  pdfName?: string;
  /** "Check before filing" results for the finished PDF. */
  preflight?: { markdown: string; json: string };
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export async function recordFiles(i: RecordInput): Promise<FileMap> {
  const files: FileMap = {};
  const roles: Record<string, string> = {};
  const one = i.originals.length === 1;
  if (!i.withoutOriginal) {
    if (i.sourcePdf) files['original/source.pdf'] = i.sourcePdf as any;
    else i.originals.forEach((b, n) => void (files[`original/page${one ? '' : `-${n + 1}`}.png`] = b as any));
  }
  i.edited.forEach((b, n) => void (files[`edited/page${one ? '' : `-${n + 1}`}-edited.png`] = b as any));
  if (i.pdf) files[i.pdfName ?? `edited/page${i.evidence ? '-exhibit' : ''}.pdf`] = i.pdf as any;
  if (i.mhtml) files['page.mhtml'] = i.mhtml;
  for (const [p, v] of Object.entries(files)) if (v instanceof Blob) files[p] = await bytesOf(v);
  for (const p of Object.keys(files)) roles[p] = p === 'original/source.pdf' ? 'The PDF exactly as opened' : p === i.pdfName ? 'Finished PDF, ready to upload' : p.startsWith('original/') ? 'Untouched capture' : p.endsWith('.pdf') ? 'A4 PDF of the edited copy' : p.endsWith('.mhtml') ? 'The page as saved by the browser' : 'Edited copy';
  if (i.evidence) {
    const row = { number: i.evidence.number, title: i.evidence.title, kind: 'Copy (printout of a web page)', createdOn: i.evidence.createdOn, author: i.evidence.author, purpose: i.evidence.purpose, notes: [i.evidence.notes, `Captured from ${i.report.url} on ${new Date(i.report.capturedAt).toISOString()}`].filter(Boolean).join(' ') };
    const head = ['Exhibit / 号証', 'Title / 標目', 'Original or copy / 原本・写しの別', 'Created / 作成年月日', 'Author / 作成者', 'What it shows / 立証趣旨', 'Notes / 備考'];
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    files['evidence-list.csv'] = '﻿' + [head.map(q).join(','), Object.values(row).map((v) => q(String(v))).join(',')].join('\r\n') + '\r\n';
    files['evidence-list.json'] = JSON.stringify(row, null, 2);
    roles['evidence-list.csv'] = 'Evidence list (draft, opens in Excel)';
    roles['evidence-list.json'] = 'Evidence list (draft, for software)';
  }
  if (i.preflight) {
    files['check-before-filing.md'] = i.preflight.markdown;
    files['check-before-filing.json'] = i.preflight.json;
    roles['check-before-filing.md'] = 'Check against the mints file rules';
    roles['check-before-filing.json'] = 'Check against the mints file rules (for software)';
  }
  files['history.json'] = JSON.stringify({ crop: i.crop, edits: i.edits, history: i.history }, null, 2);
  roles['history.json'] = 'Edit history';
  const list = [];
  for (const [path, data] of Object.entries(files)) list.push({ path, role: roles[path] ?? '', sha: await sha256(data), bytes: typeof data === 'string' ? new TextEncoder().encode(data).length : data.length });
  files['report.md'] = reportMarkdown(i.report, list, i.edits, i.crop, i.evidence);
  files['report.json'] = JSON.stringify({ capture: i.report, evidence: i.evidence ?? null, files: list, generator: 'Gleaner' }, null, 2);
  files['README-FIRST.md'] = README(!i.withoutOriginal, !!i.mhtml, !!i.evidence, i.sourcePdf ? { name: i.pdfName, checked: !!i.preflight } : undefined);
  if (i.evidence) {
    const main = list.find((f) => f.path === i.pdfName) ?? list.find((f) => f.path.endsWith('.pdf') && !f.path.startsWith('original/')) ?? list.find((f) => f.path.startsWith('edited/'));
    files['timestamp-hash.txt'] = `SHA-256 of ${main?.path}\n${main?.sha}\n\nSend only this fingerprint to a timestamp authority (RFC 3161). The file itself never needs to leave your computer.\n`;
  }
  files['SHA256SUMS.txt'] = await sha256Sums(files);
  return files;
}

// ---------- Trusted timestamp (RFC 3161) ----------

function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}
const der = (tag: number, body: number[]) => [tag, ...derLen(body.length), ...body];

/** A timestamp request (TimeStampReq) for a SHA-256 fingerprint. */
export function timestampRequest(shaHex: string, nonce = crypto.getRandomValues(new Uint8Array(8))): Uint8Array {
  const hash = shaHex.match(/../g)!.map((h) => parseInt(h, 16));
  const sha256Oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const algorithm = der(0x30, [...sha256Oid, 0x05, 0x00]);
  const imprint = der(0x30, [...algorithm, ...der(0x04, hash)]);
  const n = [...nonce];
  if (n[0] & 0x80) n.unshift(0);
  const body = [...der(0x02, [1]), ...imprint, ...der(0x02, n), ...der(0x01, [0xff])];
  return new Uint8Array(der(0x30, body));
}

export const TSA_URL = 'https://freetsa.org/tsr';

/** Asks a public timestamp authority to sign the fingerprint. Only the fingerprint is sent. */
export async function requestTimestamp(shaHex: string, url = TSA_URL): Promise<Uint8Array> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: timestampRequest(shaHex) as BufferSource });
  if (!res.ok) throw new Error(`The timestamp service answered HTTP ${res.status}`);
  const out = new Uint8Array(await res.arrayBuffer());
  // TimeStampResp starts with a SEQUENCE whose PKIStatus 0 or 1 means granted
  if (out[0] !== 0x30) throw new Error('The timestamp service sent something unexpected');
  return out;
}
