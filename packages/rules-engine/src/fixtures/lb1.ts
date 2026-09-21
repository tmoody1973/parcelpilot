import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZoningRule, type ZoningRule as Rule } from "@parcelpilot/contracts";

// Test support only (excluded from the build): the same rule data pnpm rules:seed loads.
const file = join(import.meta.dirname, "..", "..", "..", "contracts", "rules", "lb1-lb2-v1.json");
export const V1_RULES: Rule[] = (JSON.parse(readFileSync(file, "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r));
export const LB1_RULES: Rule[] = V1_RULES.filter((r) => r.district_code === "LB1");
export const LB2_RULES: Rule[] = V1_RULES.filter((r) => r.district_code === "LB2");
export const V1_CATEGORIES = ["use", "height", "setback_front", "setback_side", "setback_rear", "density"] as const;
