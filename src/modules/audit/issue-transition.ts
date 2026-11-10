import { ProjectError } from "@/modules/projects/services";
import type { IssueCommand } from "./issue-schema";
export function issueTransition(
  status: string,
  command: IssueCommand,
  role: string,
  assigned: boolean,
) {
  const { action } = command;
  const qa = ["CONFIRM", "DISMISS", "CLOSE", "RETURN", "REOPEN"].includes(
    action,
  );
  if (
    (qa && role !== "QA") ||
    (action === "ASSIGN" && !["QA", "PM"].includes(role)) ||
    (action === "SUBMIT" && (!assigned || !["PM", "MEMBER"].includes(role)))
  )
    throw new ProjectError("当前账号无权执行此整改操作", 403);
  const transitions: Record<string, [string[], string]> = {
    CONFIRM: [["PENDING"], "OPEN"],
    DISMISS: [["PENDING"], "DISMISSED"],
    ASSIGN: [["OPEN", "REMEDIATING"], "REMEDIATING"],
    SUBMIT: [["REMEDIATING"], "VERIFYING"],
    CLOSE: [["VERIFYING"], "CLOSED"],
    RETURN: [["VERIFYING"], "REMEDIATING"],
    REOPEN: [["CLOSED", "DISMISSED"], "OPEN"],
  };
  const [allowed, next] = transitions[action];
  if (!allowed.includes(status))
    throw new ProjectError("问题状态已变化或不允许此操作，请刷新", 409);
  return next;
}
