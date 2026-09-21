import { z } from "zod";

// Request schemas for the route handlers. The API layer owns input validation (02_architecture.md §5).

export const resolveInputSchema = z.union([
  z.object({ address: z.string().trim().min(1).max(200) }),
  z.object({ taxkey: z.string().trim().min(1).max(20) }),
  z.object({ point: z.object({ lon: z.number().finite(), lat: z.number().finite() }) }),
]);
export type ResolveInputBody = z.infer<typeof resolveInputSchema>;

export const newProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parcel_taxkey: z.string().trim().min(1).max(20),
  parcel_snapshot_id: z.string().uuid().nullish(),
});

// Scenario draft fields (06_delivery_plan.md M1: unit count, stories, height, parking, ground-floor use).
export const newScenarioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  use: z.string().trim().max(80).nullish(),
  units: z.number().int().min(0).max(100000).nullish(),
  height_ft: z.number().min(0).max(2000).nullish(),
  stories: z.number().int().min(0).max(200).nullish(),
  parking_spaces: z.number().int().min(0).max(100000).nullish(),
  ground_floor_commercial_sqft: z.number().min(0).max(10000000).nullish(),
  draft_inputs: z.record(z.string(), z.unknown()).optional(),
});
