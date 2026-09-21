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
