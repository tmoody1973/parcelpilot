import { z } from "zod";

// Request schemas for the route handlers. The API layer owns input validation (02_architecture.md §5).

export const resolveInputSchema = z.union([
  z.object({ address: z.string().trim().min(1).max(200) }),
  z.object({ taxkey: z.string().trim().min(1).max(20) }),
  z.object({ point: z.object({ lon: z.number().finite(), lat: z.number().finite() }) }),
]);
export type ResolveInputBody = z.infer<typeof resolveInputSchema>;
