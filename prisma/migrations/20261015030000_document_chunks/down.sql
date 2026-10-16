-- Back up chunk evidence before rollback. Stop application and document worker first.
DROP TABLE `DocumentChunk`;
ALTER TABLE `Document` DROP COLUMN `chunkedVersion`;
