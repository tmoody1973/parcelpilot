// Pure rules engine (docs/planning/05_decisioning_design.md §1). Inputs in, findings out. No I/O by lint rule.
export { evaluate } from "./evaluate.ts";
export { checkRule } from "./kinds.ts";
export { applyConditions } from "./conditions.ts";
export { readFact, evaluatePredicate } from "./facts.ts";
export const RULES_ENGINE_VERSION = "0.1.0" as const;
