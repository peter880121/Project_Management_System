-- Independent append-only conversation history; no project business table is changed.
CREATE TABLE IF NOT EXISTS RagConversation (
 id CHAR(36) NOT NULL, userId CHAR(36) NOT NULL, title VARCHAR(191) NOT NULL,
 projectId CHAR(36) NULL, rowVersion INT UNSIGNED NOT NULL DEFAULT 1,
 activeRequestId CHAR(36) NULL, leaseUntil DATETIME(3) NULL, hiddenAt DATETIME(3) NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL,
 PRIMARY KEY(id), INDEX RagConversation_userId_hiddenAt_updatedAt_idx(userId,hiddenAt,updatedAt),
 CONSTRAINT RagConversation_userId_fkey FOREIGN KEY(userId) REFERENCES User(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS RagMessage (
 id CHAR(36) NOT NULL, conversationId CHAR(36) NOT NULL, requestKey CHAR(36) NOT NULL,
 sequence INT UNSIGNED NOT NULL, role VARCHAR(16) NOT NULL,
 actorRole ENUM('ADMIN','PM','MEMBER','QA','PMO') NOT NULL,
 content TEXT NOT NULL, status VARCHAR(16) NOT NULL, scopeProjectIds JSON NOT NULL,
 model VARCHAR(191) NULL, retrievalMode VARCHAR(32) NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE INDEX RagMessage_conversationId_requestKey_role_key(conversationId,requestKey,role),
 UNIQUE INDEX RagMessage_conversationId_sequence_key(conversationId,sequence),
 INDEX RagMessage_conversationId_createdAt_idx(conversationId,createdAt),
 CONSTRAINT RagMessage_conversationId_fkey FOREIGN KEY(conversationId) REFERENCES RagConversation(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS RagCitation (
 id CHAR(36) NOT NULL, messageId CHAR(36) NOT NULL, ordinal INT UNSIGNED NOT NULL,
 sourceType VARCHAR(16) NOT NULL, projectId CHAR(36) NULL, documentId CHAR(36) NULL,
 chunkId CHAR(36) NULL, contactId CHAR(36) NULL, version INT UNSIGNED NULL,
 page INT UNSIGNED NULL, title VARCHAR(255) NOT NULL, snippet TEXT NOT NULL, contentSha256 CHAR(64) NOT NULL,
 PRIMARY KEY(id), UNIQUE INDEX RagCitation_messageId_ordinal_key(messageId,ordinal),
 INDEX RagCitation_projectId_documentId_idx(projectId,documentId),
 CONSTRAINT RagCitation_messageId_fkey FOREIGN KEY(messageId) REFERENCES RagMessage(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
