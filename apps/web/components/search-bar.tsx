"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api-client.ts";
import type { ResolveInputBody } from "../lib/validation.ts";
import type { GeocodeSuggestion } from "../lib/dto.ts";
import { Button, Input } from "./ui.tsx";

type Mode = "address" | "taxkey";

export function SearchBar({ onResolve, busy }: { onResolve: (input: ResolveInputBody) => void; busy: boolean }) {
  const [mode, setMode] = useState<Mode>("address");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (mode !== "address" || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.geocode(query.trim());
        if (id === seq.current) {
          setSuggestions(res.slice(0, 6));
          setOpen(true);
        }
      } catch {
        /* suggestions are best-effort; a failed lookup just shows none */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    onResolve(mode === "taxkey" ? { taxkey: q } : { address: q });
  }

  function choose(s: GeocodeSuggestion) {
    setQuery(s.address);
    setOpen(false);
    onResolve({ address: s.address });
  }

  return (
    <form onSubmit={submit} className="relative">
      <div className="mb-2 inline-flex rounded-md border border-line bg-canvas p-0.5 text-xs">
        {(["address", "taxkey"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded px-2.5 py-1 font-medium ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {m === "address" ? "Address" : "TAXKEY"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length && setOpen(true)}
            placeholder={mode === "address" ? "Search a Milwaukee address" : "Enter a 10-digit TAXKEY"}
            aria-label={mode === "address" ? "Address search" : "TAXKEY search"}
            data-testid="search-input"
            autoComplete="off"
          />
          {open && suggestions.length > 0 ? (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-lg" data-testid="geocode-suggestions">
              {suggestions.map((s) => (
                <li key={`${s.address}-${s.score}`}>
                  <button type="button" onClick={() => choose(s)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft">
                    {s.address}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Finding…" : "Find parcel"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Or click the map to resolve the parcel at that point.</p>
    </form>
  );
}
