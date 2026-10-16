import { z } from "zod";

export const wbsTaskSchema = z.object({
  title: z.string().trim().min(1).max(191),
  description: z.string().trim().min(1).max(5000),
  estimateHours: z.number().positive().max(10_000),
  dependencies: z.array(z.number().int().min(0)).max(30).superRefine((dependencies, context) => {
    if (new Set(dependencies).size !== dependencies.length) context.addIssue({ code: "custom", message: "A prerequisite may only be listed once" });
  }),
  suggestedRole: z.enum(["PM", "MEMBER", "QA", "ADMIN"]),
  sourceChunkIds: z.array(z.uuid()).max(4).default([]),
}).strict();

export const wbsResponseSchema = z.object({ tasks: z.array(wbsTaskSchema).min(1).max(30) }).strict().superRefine(({ tasks }, context) => {
  tasks.forEach((task, taskIndex) => {
    for (const dependencyIndex of task.dependencies) {
      if (dependencyIndex >= tasks.length || dependencyIndex === taskIndex) {
        context.addIssue({ code: "custom", path: ["tasks", taskIndex, "dependencies"], message: "Dependencies must point to a different task in the response" });
      }
    }
  });
  const visiting = new Set<number>();
  const visited = new Set<number>();
  function hasCycle(index: number): boolean {
    if (visiting.has(index)) return true;
    if (visited.has(index)) return false;
    visiting.add(index);
    for (const dependency of tasks[index]?.dependencies ?? []) {
      if (dependency < tasks.length && hasCycle(dependency)) return true;
    }
    visiting.delete(index);
    visited.add(index);
    return false;
  }
  if (tasks.some((_task, index) => hasCycle(index))) context.addIssue({ code: "custom", path: ["tasks"], message: "Task dependencies must not contain cycles" });
});

export type WbsTaskDraft = z.infer<typeof wbsTaskSchema>;
export type WbsResponse = z.infer<typeof wbsResponseSchema>;

export type HistoricalTask = Readonly<{
  id: string;
  title: string;
  description: string | null;
  actualHours: number;
  deliveryDays: number;
}>;

export const wbsDocumentEvidenceSchema = z.object({ id: z.uuid(), documentId: z.uuid(), version: z.number().int().positive(), page: z.number().int().positive().nullable(), text: z.string().max(2000), textSha256: z.string().length(64), filename: z.string().max(512) });
export type WbsDocumentEvidence = z.infer<typeof wbsDocumentEvidenceSchema>;
export function storedDocumentEvidence(input: unknown): WbsDocumentEvidence[] {
  if (!input || typeof input !== "object" || !("documentEvidence" in input)) return [];
  const parsed = z.array(wbsDocumentEvidenceSchema).max(4).safeParse(input.documentEvidence);
  return parsed.success ? parsed.data : [];
}
