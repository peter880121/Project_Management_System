/** New project-scoped models must opt into a guard or an explicit operational exception. */
export const FROZEN_PROJECT_TABLES = ["Task", "Requirement", "AIRecommendation", "AiSuggestion", "RiskScanSchedule", "RiskScanJob", "Document", "Deliverable", "MeetingRecord", "ProjectMember", "DocumentChunk", "SyncFailure", "TaskDependency", "TestCase", "ComplianceFindingReview", "DocumentParseJob", "AssetSourceJob", "RiskNotification"] as const;
export const SPECIAL_FREEZE_TABLES = ["ProjectAcceptance"] as const;
export const APPEND_ONLY_PROJECT_TABLES = ["AuditLog", "ComplianceExport", "ProjectNotification"] as const;
