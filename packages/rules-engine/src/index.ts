import { z } from "zod";

// Placeholder until MOO-800 lands the canonical contracts. The engine stays pure: inputs in, findings out.
export const RulesEngineVersion = z.literal("0.0.0");
export const RULES_ENGINE_VERSION: z.infer<typeof RulesEngineVersion> = "0.0.0";
