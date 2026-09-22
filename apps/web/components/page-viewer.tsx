"use client";

import { useEffect, useState } from "react";
import type { PageRef } from "../lib/review-dto.ts";

// The page image with boxes drawn over it, and the page text below (04 §10 step 2: "the source page image").
// Boxes come in PDF points (pdfplumber, origin top-left). The worker renders pages at scale 2.0, so the image's
// natural width in pixels is the page width in points × 2; percentages keep the overlay right at any display size.

export type Box = { bbox: [number, number, number, number] | { x0: number; y0: number; x1: number; y1: number }; label?: string | undefined; tone?: "accent" | "warn" | undefined };
const RENDER_SCALE = 2;

export function PageViewer({ page, boxes = [], caption }: { page: PageRef | null; boxes?: Box[]; caption?: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setSize(null), [page?.id]); // a new page must never be scaled with the previous image's dimensions
  if (!page) return <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">No page image is linked to this item.</p>;
  const norm = (b: Box["bbox"]): [number, number, number, number] => (Array.isArray(b) ? b : [b.x0, b.y0, b.x1, b.y1]);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="page-viewer">
      <div className="text-xs text-muted">{caption ?? `PDF page ${page.page_number}`}{page.printed_page ? ` · printed page ${page.printed_page}` : ""}</div>
      <div className="relative w-full overflow-hidden rounded-md border border-line bg-white">
        {page.image_ref ? (
          <img src={`/api/review/pages/${page.id}/image`} alt={`Page ${page.page_number}`} className="block h-auto w-full" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} data-testid="page-image" />
        ) : (
          <div className="px-3 py-6 text-center text-sm text-muted">No rendered image stored for this page.</div>
        )}
        {size ? boxes.map((b, i) => {
          const [x0, y0, x1, y1] = norm(b.bbox);
          const pct = (v: number, total: number) => `${((v * RENDER_SCALE) / total) * 100}%`;
          return (
            <div key={i} className={`pointer-events-none absolute rounded-sm border-2 ${b.tone === "warn" ? "border-warn bg-warn/10" : "border-red-600 bg-red-500/10"}`} style={{ left: pct(x0, size.w), top: pct(y0, size.h), width: pct(x1 - x0, size.w), height: pct(y1 - y0, size.h) }} data-testid="page-box" data-label={b.label ?? ""} title={b.label} />
          );
        }) : null}
      </div>
      <details className="rounded-md border border-line bg-canvas">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">Page text as extracted</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-ink" data-testid="page-text">{page.raw_text}</pre>
      </details>
    </div>
  );
}
