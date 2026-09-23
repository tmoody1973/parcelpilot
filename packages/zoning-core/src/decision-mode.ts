import { DecisionMode, DEFAULT_DECISION_MODE } from "@parcelpilot/contracts";

// Resolves the active DecisionMode. Precedence: per-org DB override > env DECISION_MODE > rules_only.
// Invalid or missing values fall back to the safe default; nothing here can raise the mode past what
// the caller explicitly configured. The DB lookup is injected so this stays free of I/O and testable.
export type DecisionModeSource = "db_override" | "env" | "default";
export type ResolvedDecisionMode = { mode: DecisionMode; source: DecisionModeSource };

export async function resolveDecisionMode(opts: {
  env?: Record<string, string | undefined>;
  orgId?: string;
  lookupOverride?: (orgId: string) => Promise<string | null | undefined>;
} = {}): Promise<ResolvedDecisionMode> {
  if (opts.orgId && opts.lookupOverride) {
    const parsed = DecisionMode.safeParse(await opts.lookupOverride(opts.orgId));
    if (parsed.success) return { mode: parsed.data, source: "db_override" };
  }
  const fromEnv = DecisionMode.safeParse((opts.env ?? process.env)["DECISION_MODE"]);
  if (fromEnv.success) return { mode: fromEnv.data, source: "env" };
  return { mode: DEFAULT_DECISION_MODE, source: "default" };
}

// The modes a run may use in M5 (MOO-836). `jev` would let JEV influence a status and needs the M6 gates (PRD §9.4);
// the structured-output baseline is an evaluation comparator that never serves users. A configuration asking for either
// is an error, not a silent downgrade, so a wrong deploy fails loudly instead of running in a mode nobody chose.
export function servableDecisionMode(resolved: ResolvedDecisionMode): "rules_only" | "shadow" {
  if (resolved.mode === "jev") throw new Error(`decision mode jev (from ${resolved.source}) is refused: JEV may influence a status only after the M6 gates pass (PRD §9.4)`);
  if (resolved.mode === "structured_output_baseline") throw new Error(`decision mode structured_output_baseline (from ${resolved.source}) is refused: the baseline is an evaluation comparator and never serves users`);
  return resolved.mode;
}
