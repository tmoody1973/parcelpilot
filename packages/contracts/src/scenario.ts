import { z } from "zod";

// Structured scenario inputs (PRD §7.2 S-02). The user confirms every field; nothing is inferred.
const Sqft = z.number().nonnegative();
export const ScenarioInputs = z.object({
  use: z.string().min(1),
  units: z.number().int().nonnegative().optional(),
  stories: z.number().int().positive().optional(),
  height_ft: Sqft.optional(),
  footprint_sqft: Sqft.optional(),
  setback_front_ft: Sqft.optional(),
  setback_side_ft: Sqft.optional(),
  setback_rear_ft: Sqft.optional(),
  parking_spaces: z.number().int().nonnegative().optional(),
  ground_floor_use: z.enum(["retail", "residential", "none"]),
  ground_floor_commercial_sqft: Sqft.optional(),
});
export type ScenarioInputs = z.infer<typeof ScenarioInputs>;
// Partial form for PATCH: any subset, same constraints.
export const ScenarioInputsPatch = ScenarioInputs.partial();
export type ScenarioInputsPatch = z.infer<typeof ScenarioInputsPatch>;
