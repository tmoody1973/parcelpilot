"use client";

import { useMemo, useState } from "react";
import { Criticality, RuleCategory, RuleKind, ZoningRule } from "@parcelpilot/contracts";
import { Button, Field, Input, Select } from "./ui.tsx";

// The proposed rule as an editable form (04 §10 step 3). Validation is the contracts ZoningRule schema itself,
// with placeholders for the fields approval fills in (id, version, citations, status), so what the reviewer saves
// is exactly what the engine can load. Params and conditions are edited as JSON: their shape depends on the kind.

export type Proposal = Record<string, unknown>;
export type ProposalPatch = { district_code?: string; category?: string; kind?: string; params?: unknown; conditions?: unknown; criticality?: string };

export function validateProposal(p: Proposal): string[] {
  const res = ZoningRule.safeParse({
    id: "pending", family_id: "pending", version: 1, jurisdiction_id: "milwaukee-wi",
    district_code: p["district_code"], category: p["category"], kind: p["kind"], params: p["params"], conditions: p["conditions"] ?? [], criticality: p["criticality"],
    citations: [{ document_id: "pending", page: 1, section: "" }], effective_start: "2025-01-01", effective_end: null,
    status: "approved", // banned-ok: contract literal, never shown
  });
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".") || "rule"}: ${i.message}`);
}

function parseJson(text: string): { value: unknown; error: string | null } {
  try { return { value: JSON.parse(text), error: null }; } catch (e) { return { value: undefined, error: e instanceof Error ? e.message : "invalid JSON" }; }
}

export function CandidateEditor({ proposal, canLowerCriticality, disabled, onSave }: { proposal: Proposal; canLowerCriticality: boolean; disabled?: boolean; onSave: (patch: ProposalPatch, reason: string) => Promise<void> }) {
  const [district, setDistrict] = useState(String(proposal["district_code"] ?? ""));
  const [category, setCategory] = useState(String(proposal["category"] ?? ""));
  const [kind, setKind] = useState(String(proposal["kind"] ?? ""));
  const [criticality, setCriticality] = useState(String(proposal["criticality"] ?? "medium"));
  const [params, setParams] = useState(JSON.stringify(proposal["params"] ?? {}, null, 2));
  const [conditions, setConditions] = useState(JSON.stringify(proposal["conditions"] ?? [], null, 2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const draft = useMemo(() => {
    const p = parseJson(params), c = parseJson(conditions);
    const jsonErrors = [p.error ? `params: ${p.error}` : null, c.error ? `conditions: ${c.error}` : null].filter((x): x is string => !!x);
    const next: Proposal = { ...proposal, district_code: district, category, kind, criticality, params: p.value, conditions: c.value };
    return { next, errors: jsonErrors.length ? jsonErrors : validateProposal(next) };
  }, [proposal, district, category, kind, criticality, params, conditions]);

  const changed = (Object.keys({ district_code: district, category, kind, criticality, params: draft.next["params"], conditions: draft.next["conditions"] }) as (keyof ProposalPatch)[])
    .filter((k) => JSON.stringify(draft.next[k]) !== JSON.stringify(proposal[k]));
  const lowering = ["critical", "high", "medium", "low"].indexOf(criticality) > ["critical", "high", "medium", "low"].indexOf(String(proposal["criticality"]));

  async function save() {
    setMessage(null);
    if (!reason.trim()) { setMessage("An edit needs a stated reason."); return; }
    if (draft.errors.length) { setMessage("Fix the validation errors first."); return; }
    if (changed.length === 0) { setMessage("Nothing changed."); return; }
    const patch: ProposalPatch = Object.fromEntries(changed.map((k) => [k, draft.next[k]]));
    setBusy(true);
    try { await onSave(patch, reason.trim()); setReason(""); setMessage("Edit saved."); } catch (e) { setMessage(e instanceof Error ? e.message : "Edit failed."); } finally { setBusy(false); }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="candidate-editor">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="District"><Input value={district} onChange={(e) => setDistrict(e.target.value.toUpperCase())} disabled={disabled} /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={disabled}>{RuleCategory.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field>
        <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value)} disabled={disabled}>{RuleKind.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field>
        <Field label="Criticality" hint={!canLowerCriticality ? "Only an owner may lower criticality." : undefined}>
          <Select value={criticality} onChange={(e) => setCriticality(e.target.value)} disabled={disabled} data-testid="criticality-select">{Criticality.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
        </Field>
      </div>
      <Field label="Params (JSON, shape depends on kind)"><textarea className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs" rows={4} value={params} onChange={(e) => setParams(e.target.value)} disabled={disabled} data-testid="params-input" /></Field>
      <Field label="Conditions (JSON array)"><textarea className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs" rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)} disabled={disabled} /></Field>
      {draft.errors.length ? <ul className="list-disc rounded-md bg-red-50 px-6 py-2 text-xs text-red-700" data-testid="validation-errors">{draft.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {lowering && !canLowerCriticality ? <p className="text-xs text-warn">Lowering criticality needs an owner; this edit will be refused.</p> : null}
      <Field label="Reason for the edit" hint="Required. Kept with the task for audit."><Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} data-testid="edit-reason" placeholder="e.g. cell reads 46 on the page" /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" disabled={disabled || busy} data-testid="save-edit">Save edit</Button>
        {message ? <span className="text-xs text-muted" data-testid="edit-message">{message}</span> : null}
      </div>
    </form>
  );
}
