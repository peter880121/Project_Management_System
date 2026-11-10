import { z } from "zod";
export const projectMaintenanceSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("details"), expectedRowVersion: z.number().int().positive(), name: z.string().trim().min(1).max(191), description: z.string().trim().max(5000) }).strict(),
  z.object({ operation: z.literal("transfer"), expectedRowVersion: z.number().int().positive(), ownerId: z.uuid(), confirmationName: z.string().max(191), reason: z.string().trim().min(10).max(1000) }).strict(),
]);
