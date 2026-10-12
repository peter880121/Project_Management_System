import { z } from "zod";

export const complianceSummarySchema = z.object({
  overview: z.string().min(1).max(2000),
  keyChanges: z.array(z.object({ summary: z.string().min(1).max(500), auditIds: z.array(z.uuid()).max(20) }).strict()).max(20),
  anomalies: z.array(z.object({ summary: z.string().min(1).max(500), auditIds: z.array(z.uuid()).max(20), recordIds: z.array(z.uuid()).max(30) }).strict()).max(30),
  reviewItems: z.array(z.object({ summary: z.string().min(1).max(500), auditIds: z.array(z.uuid()).max(20), recordIds: z.array(z.uuid()).max(30) }).strict()).max(30),
}).strict();

export type ComplianceSummary = z.infer<typeof complianceSummarySchema>;

export type ComplianceAuditInput = {
  auditLogs: { id: string; action: string; entityType: string; entityId: string; createdAt: Date }[];
  tasks: { id: string; status: string; requirementId: string | null; updatedAt: Date }[];
  requirements: { id: string; updatedAt: Date }[];
  testCases: { id: string; requirementId: string; status: string }[];
};

export type ComplianceFinding = { summary: string; auditIds: string[]; recordIds: string[] };
export type ComplianceAuditResult = {
  summary: ComplianceSummary;
  auditLogs: ComplianceAuditInput["auditLogs"];
  degraded: boolean;
};
