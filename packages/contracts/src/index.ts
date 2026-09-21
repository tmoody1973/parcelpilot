import { z } from "zod";

// Canonical enums arrive in MOO-800 from docs/planning/00_conventions.md.
export const ContractsVersion = z.literal("0.0.0");
export const CONTRACTS_VERSION: z.infer<typeof ContractsVersion> = "0.0.0";
