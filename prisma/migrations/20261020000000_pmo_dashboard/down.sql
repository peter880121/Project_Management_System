-- Maintenance rollback of optional analytics indexes only. Keep PMO enum/accounts;
-- never coerce existing identities into another role or delete their audit evidence.
DROP INDEX `Project_status_archivedAt_idx` ON `Project`;
DROP INDEX `AiSuggestion_projectId_type_status_createdAt_idx` ON `AiSuggestion`;
DROP INDEX `Deliverable_createdAt_idx` ON `Deliverable`;
-- Removing PMO from the enum requires an explicit account migration and is not automatic.
