import { z } from "zod";
import { planningDate } from "@/modules/planning/schemas";
import { completionDateSchema } from "@/modules/tasks/plan";

export const workflowLabels = { DRAFT: "草稿", IN_REVIEW: "待评审", APPROVED: "已批准", IMPLEMENTING: "实施中", VERIFYING: "待验证", CUSTOMER_CONFIRMATION: "待客户确认", CLOSED: "已关闭", CANCEL_REVIEW: "取消待审批", CANCELLED: "已取消" } as const;
export const intakeLabels = { SUBMITTED: "待分诊", CLARIFYING: "待澄清", CONVERTED: "已纳入需求", DEFERRED: "延期处理", REJECTED: "已拒绝", DUPLICATE: "重复诉求" } as const;
export const priorityLabels = { MUST: "必须", SHOULD: "应该", COULD: "可以", LATER: "暂不纳入" } as const;
export const categoryLabels = { FUNCTIONAL: "功能需求", NON_FUNCTIONAL: "非功能需求", INTERFACE: "接口需求", DATA: "数据需求", COMPLIANCE: "合规需求", EXPERIENCE: "体验优化", DEFECT: "缺陷反馈" } as const;
export const workflowSchema = z.enum(Object.keys(workflowLabels) as [keyof typeof workflowLabels, ...(keyof typeof workflowLabels)[]]);
const reason = z.string().trim().min(10, "请填写至少 10 字的说明").max(2000);
export const requirementFields = {
  title: z.string().trim().min(1).max(191), content: z.string().trim().min(1).max(20000),
  acceptanceCriteria: z.string().trim().min(5, "请填写可验证的验收标准").max(10000),
  dueDate: planningDate, ownerId: z.uuid().nullable().default(null),
  priority: z.enum(["MUST", "SHOULD", "COULD", "LATER"]).default("SHOULD"),
  category: z.enum(["FUNCTIONAL", "NON_FUNCTIONAL", "INTERFACE", "DATA", "COMPLIANCE", "EXPERIENCE", "DEFECT"]).default("FUNCTIONAL"),
  riskLevel: z.enum(["NORMAL", "HIGH"]).default("NORMAL"),
  discoveryPhase: z.string().trim().max(50).default(""), targetRelease: z.string().trim().max(100).default(""),
};
export const createRequirementSchema = z.object({ ...requirementFields, requestKey: z.uuid(), intakeId: z.uuid().optional() }).strict();
export const editRequirementSchema = z.object({ ...requirementFields, expectedRowVersion: z.number().int().positive() }).strict();
export const actionSchema = z.object({
  expectedRowVersion: z.number().int().positive(), requestKey: z.uuid(), comment: z.string().trim().max(2000).default(""),
  signaturePassword: z.string().min(1).max(72).refine(v => new TextEncoder().encode(v).length <= 72, "密码过长").optional(),
  completedAt: completionDateSchema.optional(), taskId: z.uuid().optional(), documentId: z.uuid().optional(),
  testCaseId: z.uuid().optional(), result: z.enum(["PASSED", "FAILED", "BLOCKED"]).optional(),
  impact: z.object({ schedule: z.string().trim().min(1).max(1000), cost: z.string().trim().min(1).max(1000), scope: z.string().trim().min(1).max(2000), risk: z.string().trim().min(1).max(1000) }).strict().optional(),
}).strict();
export const operations = ["submit", "approve", "return", "start", "verify", "record-test", "confirm-verification", "customer-confirm", "request-fix", "close", "cancel", "approve-cancel", "return-cancel", "withdraw-change", "change", "link-task", "comment"] as const;
export type RequirementOperation = typeof operations[number];
export const intakeSchema = z.object({ title: z.string().trim().min(1).max(191), content: z.string().trim().min(1).max(20000), requester: z.string().trim().min(1).max(191), source: z.enum(["CUSTOMER", "MEETING", "TESTING", "MAINTENANCE", "INTERNAL"]), sourceReference: z.string().trim().max(191).default(""), requestKey: z.uuid() }).strict();
export const intakeActionSchema = z.object({ expectedRowVersion: z.number().int().positive(), state: z.enum(["SUBMITTED", "CLARIFYING", "DEFERRED", "REJECTED", "DUPLICATE"]), reason, requirementId: z.uuid().optional() }).strict();
export const baselineSchema = z.object({ name: z.string().trim().min(1).max(191), requirementIds: z.array(z.uuid()).min(1).max(200).refine(ids => new Set(ids).size === ids.length, "需求不可重复") }).strict();
export const listSchema = z.object({ q: z.string().trim().max(100).default(""), state: z.union([workflowSchema, z.literal("")]).default(""), priority: z.enum(["", "MUST", "SHOULD", "COULD", "LATER"]).default(""), ownerId: z.union([z.uuid(), z.literal("")]).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) });
export const reasonSchema = reason;
