import type { Column } from '@/lib/db';
import { looksLikeImage, looksLikeUrl } from '@/lib/columns';

export function Cell({ value }: { value: string }) {
  if (!value) return <span className="text-muted/60">-</span>;
  if (looksLikeImage(value)) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <img src={value} alt="" loading="lazy" className="size-8 shrink-0 rounded border border-line object-cover" />
        <span className="truncate text-muted">{value}</span>
      </span>
    );
  }
  if (looksLikeUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="block min-w-0 truncate text-accent-text hover:underline">
        {value}
      </a>
    );
  }
  return <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{value}</span>;
}

export function PreviewTable({ columns, rows, max = 5 }: { columns: Column[]; rows: Record<string, string>[]; max?: number }) {
  if (!columns.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-max min-w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-surface-2 text-left">
            {columns.map((c) => (
              <th key={c.key} scope="col" className="max-w-[220px] truncate px-2.5 py-2 font-medium whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-line bg-surface">
              {columns.map((c) => (
                <td key={c.key} className="max-w-[220px] px-2.5 py-1.5 align-top">
                  <div className="flex max-w-[220px] min-w-0 overflow-hidden">
                    <Cell value={r[c.key] ?? ''} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="border-t border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-muted">and {rows.length - max} more rows</p>}
    </div>
  );
}
