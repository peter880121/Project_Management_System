import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(5000).default(""),
}).strict();

const requirement = {
  title: z.string().trim().min(1).max(191),
  content: z.string().trim().min(1).max(20000),
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "RETIRED"]),
};
const testCase = {
  title: z.string().trim().min(1).max(191),
  status: z.enum(["NOT_RUN", "PASSED", "FAILED", "BLOCKED"]),
};
export const traceCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requirement"), ...requirement }).strict(),
  z.object({ kind: z.literal("testCase"), requirementId: z.uuid(), ...testCase }).strict(),
]);
export const traceUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requirement"), id: z.uuid(), expectedVersion: z.number().int().positive(), ...requirement }).strict(),
  z.object({ kind: z.literal("testCase"), id: z.uuid(), expectedUpdatedAt: z.iso.datetime(), ...testCase }).strict(),
  z.object({ kind: z.literal("task"), id: z.uuid(), requirementId: z.uuid().nullable(), expectedRequirementId: z.uuid().nullable() }).strict(),
]);
export type TraceCreate = z.infer<typeof traceCreateSchema>;
export type TraceUpdate = z.infer<typeof traceUpdateSchema>;
