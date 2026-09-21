import type { ZoningRule } from "@parcelpilot/contracts";
import { evaluatePredicate, type FactContext } from "./facts.ts";

export type ConditionResult =
  | { verify: false; params: Record<string, unknown>; applied: string[] }
  | { verify: true; reason: string; applied: string[] };

// Walks a rule's reviewed footnotes (05 §1.3). A condition whose `when` cannot be resolved, or
// that is active but not evaluable, forces verify: the engine never silently ignores a footnote.
export function applyConditions(rule: ZoningRule, ctx: FactContext): ConditionResult {
  let params: Record<string, unknown> = { ...rule.params };
  let applied: string[] = [];
  for (const c of rule.conditions) {
    if (c.when) {
      const active = evaluatePredicate(c.when, ctx);
      if (active === null) return { verify: true, reason: `condition_unevaluable:${c.id}`, applied };
      if (!active) continue;
    }
    if (!c.evaluable || "status" in c.effect) return { verify: true, reason: `condition_unevaluable:${c.id}`, applied };
    params = { ...params, [c.effect.param]: c.effect.value };
    applied = [...applied, c.id];
  }
  return { verify: false, params, applied };
}
