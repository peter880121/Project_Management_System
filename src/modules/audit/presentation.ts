/** Deterministic presentation: evidence is never rewritten by an LLM. */
export const actionLabels: Record<string, string> = {
  TASK_CREATED: "创建任务",
  TASK_STATUS_CHANGED: "更新任务状态",
  TASK_SIGNED_AND_COMPLETED: "签署并完成任务",
  TASK_ASSIGNED: "调整任务负责人",
  TASK_SCHEDULE_UPDATED: "调整任务计划",
  TASK_DETAILS_UPDATED: "更新任务信息",
  TASK_CANCELLED: "取消任务",
  TASK_REOPENED: "重新打开任务",
  TASK_DEPENDENCY_INVALIDATED: "前置任务失效",
  TASK_REQUIREMENT_CHANGED: "调整关联需求",
  TASK_DELIVERABLE_REQUIREMENT_CHANGED: "调整交付物要求",
  PROJECT_CREATED: "创建项目",
  PROJECT_ACTIVATED: "启动项目",
  PROJECT_SUBMITTED: "提交项目验收",
  PROJECT_QA_APPROVED: "通过质量验收",
  PROJECT_ARCHIVED: "归档项目",
  PROJECT_PAUSED: "暂停项目",
  PROJECT_RESUMED: "恢复项目",
  PROJECT_CANCELLED: "取消项目",
  PROJECT_DETAILS_UPDATED: "更新项目信息",
  PROJECT_OWNER_TRANSFERRED: "移交项目负责人",
  PROJECT_MEMBER_UPDATED: "调整项目成员",
  PROJECT_ACCEPTANCE_REJECTED: "退回项目验收",
  PROJECT_ACCEPTANCE_WITHDRAWN: "撤回项目验收",
  PROJECT_COMPLIANCE_CHECKED: "执行合规检查",
  PROJECT_ACCEPTANCE_OVERRIDE_SUBMITTED: "提交验收例外申请",
  PROJECT_NOTIFICATION_READ: "阅读项目通知",
  DATA_EXPORTED: "导出数据",
  COMPLIANCE_EXPORT_PREPARED: "生成合规证据包",
  COMPLIANCE_EXPORT_FAILED: "证据包生成失败",
  COMPLIANCE_EXPORT_CLEANED: "清理导出文件",
  AI_AUDIT_SUMMARY_GENERATED: "生成合规审查摘要",
  COMPLIANCE_FINDING_REVIEWED: "复核审计发现",
  REQUIREMENT_VERSION_REVIEWED: "复核需求版本",
  AUDIT_ISSUE_CHANGED: "更新审计整改",
  AUDIT_ISSUE_DETECTED: "登记审计发现",
  AUDIT_REPORT_EXPORTED: "导出整改报告",
  AI_SUGGESTION_ACCEPTED: "采纳 AI 建议",
  AI_SUGGESTION_REJECTED: "拒绝 AI 建议",
  AI_WBS_GENERATED: "生成任务拆解建议",
  AI_WBS_GENERATION_FAILED: "任务拆解生成失败",
  AI_RISK_SUGGESTIONS_GENERATED: "生成风险建议",
  AI_RISK_SUGGESTION_HANDLED: "处理风险建议",
  AI_RISK_SUGGESTION_IGNORED: "忽略风险建议",
  AI_GENERATION_CANCELLED: "停止 AI 生成",
  AI_ACCEPTANCE_DIAGNOSIS_GENERATED: "生成验收诊断",
  AI_MEETING_GENERATED: "生成会议纪要建议",
  AI_MEETING_GENERATION_FAILED: "会议纪要生成失败",
  REQUIREMENT_CREATED: "创建需求",
  REQUIREMENT_UPDATED: "更新需求",
  REQUIREMENT_WORKFLOW_CHANGED: "更新需求流程",
  REQUIREMENT_INTAKE_CREATED: "登记需求反馈",
  REQUIREMENT_INTAKE_TRIAGED: "处理需求反馈",
  REQUIREMENT_BASELINE_CREATED: "建立需求基线",
  REQUIREMENT_IMAGE_UPLOADED: "上传需求图片",
  TEST_CASE_CREATED: "创建测试用例",
  TEST_CASE_UPDATED: "更新测试用例",
  DOCUMENT_UPLOAD_STARTED: "开始上传文档",
  DOCUMENT_UPLOADED: "上传文档",
  DOCUMENT_UPLOAD_FAILED: "文档上传失败",
  DOCUMENT_UPLOAD_RECOVERED: "恢复文档上传",
  DOCUMENT_PARSE_REQUESTED: "请求解析文档",
  DOCUMENT_PARSE_STARTED: "开始解析文档",
  DOCUMENT_PARSE_SUCCEEDED: "完成文档解析",
  DOCUMENT_PARSE_FAILED: "文档解析失败",
  DOCUMENT_CHUNKED: "完成文档分块",
  DOCUMENT_CHUNK_FAILED: "文档分块失败",
  DOCUMENT_VECTOR_SYNCED: "完成向量同步",
  DOCUMENT_VECTOR_FAILED: "向量同步失败",
  VECTOR_SYNC_RETRIED: "重试向量同步",
  DOCUMENT_CLEANUP_RETRIED: "重试文档清理",
  DOCUMENT_PARSE_ARTIFACT_CLEANED: "清理解析产物",
  PERMISSION_CHANGED: "变更用户权限",
  USER_CREATED_BY_ADMIN: "创建用户",
  USER_STATUS_CHANGED: "变更用户状态",
  PASSWORD_CHANGED: "修改密码",
  LOGOUT: "退出登录",
  ACCEPTANCE_OVERRIDE_PERMISSION_CHANGED: "调整验收例外权限",
  MEETING_CREATED: "创建会议",
  MEETING_UPDATED: "更新会议",
  MEETING_FINALIZED: "确认会议纪要",
  MEETING_ACTION_ITEM_CONVERTED: "将行动项转为任务",
  MEETING_ATTACHMENT_ADDED: "添加会议附件",
  DELIVERABLE_CREATED: "创建交付物",
  DELIVERABLE_UPDATED: "更新交付物",
  DELIVERABLE_SUBMITTED: "提交交付物审批",
  DELIVERABLE_REVIEWED: "审批交付物",
  ASSET_INDEX_REQUESTED: "请求资产索引",
  ASSET_SOURCE_SYNCED: "同步资产来源",
  ASSET_SOURCE_FAILED: "资产同步失败",
  RAG_SEARCH: "检索知识库",
  RAG_WEB_SEARCH_CONFIRMED: "确认联网检索",
  RAG_WEB_SEARCH_STARTED: "开始联网检索",
  RAG_CONVERSATION_CREATED: "创建助手会话",
  RAG_CONVERSATION_UPDATED: "更新助手会话",
  RAG_QUESTION_SUBMITTED: "提交助手问题",
  RAG_ANSWER_COMPLETED: "完成助手回答",
  RAG_ANSWER_STOPPED: "停止助手回答",
  RAG_ANSWER_FAILED: "助手回答失败",
  WEEKLY_REPORT_DRAFTED: "创建周报",
  WEEKLY_REPORT_UPDATED: "更新周报",
  WEEKLY_REPORT_SUBMITTED: "提交周报",
  WEEKLY_REPORT_READ: "阅读周报",
  WEEKLY_REPORT_RETURNED: "退回周报",
  WEEKLY_REPORT_EXEMPTED: "豁免周报",
  WEEKLY_REPORT_REVISION_STARTED: "开始修订周报",
  DECISION_SNAPSHOT_CAPTURED: "记录决策快照",
  MEMBER_CAPACITY_UPDATED: "更新成员产能",
  RISK_SCHEDULE_UPDATED: "更新风险扫描计划",
  RISK_JOB_QUEUED: "风险扫描已排队",
  RISK_JOB_STARTED: "开始风险扫描",
  RISK_JOB_COMPLETED: "完成风险扫描",
  RISK_JOB_FAILED: "风险扫描失败",
  RISK_JOB_SKIPPED: "跳过风险扫描",
  RISK_JOB_RETRIED: "重试风险扫描",
  RISK_NOTIFICATIONS_CREATED: "发送风险通知",
  RISK_NOTIFICATION_READ: "阅读风险通知",
};
export const findingLabels: Record<string, string> = {
  TASK_WITHOUT_REQUIREMENT: "任务缺少关联需求",
  APPROVED_REQUIREMENT_WITHOUT_TASK: "已批准需求尚未落实到任务",
  REQUIREMENT_WITHOUT_TEST: "需求缺少测试覆盖",
  DONE_TASK_WITH_UNPASSED_TEST: "已完成任务的关联测试未通过",
  TASK_REQUIREMENT_REVIEW_STALE: "任务尚未复核当前需求版本",
  TEST_REQUIREMENT_REVIEW_STALE: "测试尚未复核当前需求版本",
};
export const statusLabels: Record<string, string> = {
  PLANNING: "规划中",
  ON_HOLD: "已暂停",
  COMPLETED: "已完成",
  PENDING_REVIEW: "待审批",
  DISABLED: "已停用",
  AVAILABLE: "可用",
  QUEUED: "等待处理",
  RUNNING: "处理中",
  SUCCEEDED: "成功",
  IN_REVIEW: "审核中",
  IMPLEMENTING: "实施中",
  VERIFIED: "已验证",
  RETIRED: "已退役",
  HANDLED: "已处理",
  IGNORED: "已忽略",
  RULE_BASED_FALLBACK: "规则降级",
  AI_SUMMARY: "AI 摘要",
  TODO: "待开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  BLOCKED: "受阻",
  CANCELLED: "已取消",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  DRAFT: "草稿",
  PENDING: "待复核",
  PENDING_ACCEPTANCE: "待验收",
  ARCHIVED: "已归档",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
  ACCEPTED: "已采纳",
  CONFIRMED: "已确认",
  DISMISSED: "已判定误报",
  PASSED: "通过",
  FAILED: "失败",
  UNSCHEDULED: "未排期",
  SCHEDULED: "已排期",
  ADMIN: "管理员",
  PM: "项目经理",
  MEMBER: "项目成员",
  QA: "质量专员",
  PMO: "项目管理办公室",
  OPEN: "待分派",
  REMEDIATING: "整改中",
  VERIFYING: "待验证",
  CLOSED: "已关闭",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
const fields: Record<string, string> = {
  title: "标题",
  name: "名称",
  status: "状态",
  description: "说明",
  assigneeId: "负责人",
  ownerId: "项目负责人",
  role: "角色",
  actorRole: "操作时角色",
  phase: "所属阶段",
  estimateHours: "预计工时",
  actualHours: "实际工时",
  dueDate: "预计完成日期",
  plannedStartDate: "预计开始日期",
  completedAt: "实际完成日期",
  planningStatus: "排期状态",
  requiresDeliverable: "需要交付物",
  requirementId: "关联需求",
  reviewedRequirementVersion: "已复核需求版本",
  signatureReason: "签署原因",
  cancelReason: "取消原因",
  reason: "原因",
  note: "说明",
  comment: "意见",
  decision: "处理结论",
  format: "导出格式",
  scope: "数据范围",
  query: "检索内容",
  hitIds: "检索命中",
  durationMs: "耗时（毫秒）",
  degraded: "已降级",
  findingCount: "发现问题数",
  reviewedById: "复核人",
  notifiedUserIds: "通知对象",
  acceptanceId: "验收记录",
  snapshotSha256: "证据摘要 SHA-256",
  version: "版本",
  rowVersion: "记录版本",
  projectId: "所属项目",
  taskId: "关联任务",
  summaryId: "检查记录",
  signatureEvidenceVersion: "签署证据版本",
  completionRoundId: "完成轮次",
  autoGenerated: "自动生成",
  dependencies: "前置任务",
  dependencyIds: "前置任务",
  evidenceIds: "整改证据",
  severity: "风险等级",
  assignedToId: "整改负责人",
  action: "处理动作",
};
export const entityLabels: Record<string, string> = {
  Task: "任务",
  Project: "项目",
  Requirement: "需求",
  TestCase: "测试用例",
  Document: "文档",
  User: "用户",
  AuditSummary: "审查摘要",
  AiSuggestion: "AI 建议",
  ProjectAcceptance: "项目验收",
  DataExport: "数据导出",
  ComplianceExport: "合规证据包",
  AuditIssue: "审计问题",
  ComplianceFindingReview: "问题复核",
  RagQuery: "知识检索",
  MeetingRecord: "会议",
  Deliverable: "交付物",
};
export function actionLabel(action: string) {
  return actionLabels[action] ?? "其他操作（详情可查事件编码）";
}
export function auditCategory(action: string) {
  return /PERMISSION|USER_|PASSWORD|LOGOUT/.test(action)
    ? "权限与账号"
    : /EXPORT/.test(action)
      ? "数据导出"
      : /AI_|RAG_|COMPLIANCE|AUDIT_|RISK_/.test(action)
        ? "AI 与合规"
        : /TASK_|MEMBER_CAPACITY/.test(action)
          ? "任务与计划"
          : "项目与资产";
}
export const auditCategories = [
  "权限与账号",
  "数据导出",
  "AI 与合规",
  "任务与计划",
  "项目与资产",
] as const;
export function auditTime(value: string | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未记录"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date) + " UTC+8";
}
export type AuditDisplayRow = {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  projectId?: string | null;
  createdAt: string | Date;
  before: unknown;
  after: unknown;
  actor?: { name: string; id?: string; role?: string };
  actorRole?: string | null;
  projectName?: string | null;
  entityName?: string | null;
  entityHref?: string | null;
  names?: Record<string, string>;
  ip?: string | null;
  userAgent?: string | null;
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function canonical(value: unknown): string {
  if (value && typeof value === "object")
    return JSON.stringify(
      Array.isArray(value)
        ? value.map(canonical)
        : Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return JSON.stringify(value) ?? "undefined";
}
export function displayValue(
  value: unknown,
  names: Record<string, string> = {},
): string {
  const result = formatValue(value, names);
  return result.length > 600
    ? result.slice(0, 600) + "…（完整内容见原始证据）"
    : result;
}
function formatValue(value: unknown, names: Record<string, string>): string {
  if (value === undefined) return "未记录";
  if (value === null || value === "") return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") {
    if (names[value]) return `${names[value]}（当前名称）`;
    if (statusLabels[value]) return statusLabels[value];
    if (/^\d{4}-\d\d-\d\dT/.test(value)) return auditTime(value);
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))
      return `记录 ${value.slice(0, 8)}…（未保存历史名称）`;
    return value;
  }
  if (Array.isArray(value))
    return value.length
      ? value
          .slice(0, 10)
          .map((v) => displayValue(v, names))
          .join("、") + (value.length > 10 ? `…（共 ${value.length} 项）` : "")
      : "无";
  if (typeof value === "object")
    return (
      Object.entries(value)
        .map(([k, v]) => `${fields[k] ?? k}：${displayValue(v, names)}`)
        .join("；") || "无"
    );
  return String(value);
}
export function auditChanges(
  row: Pick<AuditDisplayRow, "before" | "after" | "names" | "entityType">,
) {
  const before = object(row.before),
    after = object(row.after);
  const value = (key: string, input: unknown) =>
    row.entityType === "User" && key === "status" && typeof input === "string"
      ? ((
          { ACTIVE: "已启用", DISABLED: "已停用", PENDING: "待激活" } as Record<
            string,
            string
          >
        )[input] ?? displayValue(input, row.names))
      : displayValue(input, row.names);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => canonical(before[k]) !== canonical(after[k]))
    .map((key) => ({
      key,
      label: fields[key] ?? `补充字段 · ${key}`,
      before: value(key, before[key]),
      after: value(key, after[key]),
    }));
}
