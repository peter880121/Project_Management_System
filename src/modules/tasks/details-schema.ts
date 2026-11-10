import { z } from "zod";
import { phaseSchema } from "./plan";
export const taskDetailsSchema = z.object({
  operation: z.literal("details"), expectedRowVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(191), description: z.string().trim().max(9900), phase: phaseSchema,
}).strict();
