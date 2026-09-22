import type { FragmentRef } from "../lib/review-dto.ts";
import { SIGNAL_COPY } from "../lib/review-copy.ts";
import { PageViewer } from "./page-viewer.tsx";
import { Badge } from "./ui.tsx";

// A table family's fragments side by side, each with the continuation signals that fired (04 §3.6 list) and its
// detected header row, so a reviewer can confirm the pages are one table and the headers carry over.
export function MergeView({ fragments, columns }: { fragments: FragmentRef[]; columns: string[] }) {
  return (
    <div className="flex flex-col gap-3" data-testid="merge-view">
      <p className="text-xs text-muted">Canonical columns: {columns.join(", ") || "none detected"}. Each fragment below is one page; signals are the 04 §3.6 checks that agreed.</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {fragments.map((f) => (
          <section key={f.id} className="min-w-0 rounded-md border border-line bg-surface p-3" data-testid="fragment">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">PDF page {f.page_number}{f.page?.printed_page ? ` · printed ${f.page.printed_page}` : ""}</span>
              <span className="text-xs text-muted">{f.extractor} · {f.rows.length} rows</span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1" data-testid="signals">
              {f.continuation_signals.map((s) => <li key={s}><Badge tone={s === "column_block_changed" ? "warn" : s === "first_fragment" ? "neutral" : "ok"}>{SIGNAL_COPY[s] ?? s}</Badge></li>)}
            </ul>
            <p className="mt-2 truncate font-mono text-xs text-muted" title={JSON.stringify(f.headers)}>headers: {Array.isArray(f.headers) ? (f.headers as string[]).join(" | ") : JSON.stringify(f.headers)}</p>
            <div className="mt-2">
              <PageViewer page={f.page} boxes={[{ bbox: f.bbox, label: "table", tone: "warn" }]} caption={`Fragment on PDF page ${f.page_number}`} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
