import { z } from "zod";
export const issueStates = [
  "PENDING",
  "OPEN",
  "REMEDIATING",
  "VERIFYING",
  "CLOSED",
  "DISMISSED",
] as const;
export const issueActions = [
  "CONFIRM",
  "DISMISS",
  "ASSIGN",
  "SUBMIT",
  "CLOSE",
  "RETURN",
  "REOPEN",
] as const;
export const issueActionLabels: Record<string, string> = {
  DETECT: "登记发现",
  CONFIRM: "确认问题",
  DISMISS: "判定误报",
  ASSIGN: "分派整改",
  SUBMIT: "提交整改",
  CLOSE: "验证并关闭",
  RETURN: "退回整改",
  REOPEN: "重新打开",
};
export const issueCommandSchema = z
  .object({
    action: z.enum(issueActions),
    expectedRowVersion: z.number().int().positive(),
    note: z.string().trim().min(1).max(2000),
    assignedToId: z.uuid().optional(),
    dueDate: z.iso.datetime({ offset: true }).optional(),
    severity: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
    evidenceIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === "ASSIGN" && (!v.assignedToId || !v.dueDate))
      ctx.addIssue({ code: "custom", message: "请选择负责人和截止日期" });
    if (v.action === "SUBMIT" && !v.evidenceIds.length)
      ctx.addIssue({ code: "custom", message: "提交整改必须关联至少一项证据" });
  });
export type IssueCommand = z.infer<typeof issueCommandSchema>;
