-- Structural rollback discards new review records/fields. AuditLog remains intact.
DROP TABLE `ComplianceFindingReview`;
ALTER TABLE `Task` DROP FOREIGN KEY `Task_requirementReviewedById_fkey`;
ALTER TABLE `TestCase` DROP FOREIGN KEY `TestCase_requirementReviewedById_fkey`;
ALTER TABLE `Task` DROP INDEX `Task_requirementReviewedById_fkey`, DROP COLUMN `reviewedRequirementVersion`, DROP COLUMN `requirementReviewedById`, DROP COLUMN `requirementReviewedAt`;
ALTER TABLE `TestCase` DROP INDEX `TestCase_requirementReviewedById_fkey`, DROP COLUMN `reviewedRequirementVersion`, DROP COLUMN `requirementReviewedById`, DROP COLUMN `requirementReviewedAt`;
