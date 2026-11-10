/** New project-scoped models must opt into a guard or an explicit operational exception. */
export const FROZEN_PROJECT_TABLES = ["Task", "Requirement", "AIRecommendation", "AiSuggestion", "RiskScanSchedule", "RiskScanJob", "Document", "Deliverable", "MeetingRecord", "ProjectMember", "DocumentChunk", "SyncFailure", "TaskDependency", "TestCase", "ComplianceFindingReview", "DocumentParseJob", "AssetSourceJob", "RiskNotification"] as const;
export const REQUIREMENT_PROJECT_TABLES = ["RequirementIntake", "RequirementRevision", "RequirementChangeRequest", "RequirementTaskLink", "RequirementDecision", "TestExecution", "RequirementBaseline", "RequirementAttachment"] as const;
export const SPECIAL_FREEZE_TABLES = ["ProjectAcceptance", ...REQUIREMENT_PROJECT_TABLES] as const;
export const APPEND_ONLY_PROJECT_TABLES = ["ProjectStatusChange", "ProjectComplianceCheck", "AuditLog", "ComplianceExport", "ProjectNotification", "DecisionSnapshot"] as const;
/** User-private read-session metadata/evidence; never mutates project business assets. */
export const READ_SESSION_PROJECT_TABLES = ["RagConversation", "RagCitation", "WeeklyReportSection"] as const;
/** Audit remediation remains operable after archive/cancel; it never changes frozen business assets.
 * Mutable issue status is supported by immutable occurrences, events and AuditLog records. */
export const AUDIT_OPERATIONAL_TABLES = ["AuditIssue"] as const;
// WeeklyReportSection is a user-authored reporting record, not an editable project asset.
// Its projectId is a permission-filtered reference; no project business write is permitted.
