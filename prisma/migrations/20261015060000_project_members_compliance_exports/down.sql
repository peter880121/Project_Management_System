-- Stop app/workers and back up exports and membership grants before rollback.
-- Rolling back removes project isolation; restore the prior application only in a controlled environment.
DROP TABLE `ComplianceExport`;
DROP TABLE `ProjectMember`;
