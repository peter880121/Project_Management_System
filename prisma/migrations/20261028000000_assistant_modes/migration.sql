-- Additive and replayable. Existing turns keep INTERNAL mode; no historical content is rewritten.
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagMessage' AND COLUMN_NAME='mode')=0,'ALTER TABLE RagMessage ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT ''INTERNAL''','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagMessage' AND COLUMN_NAME='intent')=0,'ALTER TABLE RagMessage ADD COLUMN intent VARCHAR(32) NULL','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagMessage' AND COLUMN_NAME='webQuery')=0,'ALTER TABLE RagMessage ADD COLUMN webQuery VARCHAR(2000) NULL','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagCitation' AND COLUMN_NAME='webUrl')=0,'ALTER TABLE RagCitation ADD COLUMN webUrl VARCHAR(2048) NULL','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagCitation' AND COLUMN_NAME='retrievedAt')=0,'ALTER TABLE RagCitation ADD COLUMN retrievedAt DATETIME(3) NULL','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
SET @rag_mode_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='RagCitation' AND COLUMN_NAME='publishedAt')=0,'ALTER TABLE RagCitation ADD COLUMN publishedAt DATETIME(3) NULL','SELECT 1');
PREPARE rag_mode_stmt FROM @rag_mode_ddl; EXECUTE rag_mode_stmt; DEALLOCATE PREPARE rag_mode_stmt;
