# Audit

Audit trails are first-class records. Preserve actor, optional project scope, action, entity, before/after state, IP, user agent, and UTC timestamp. Never store PHI.

`recordAudit(tx, event)` requires a Prisma transaction client. Business services update the record and write its audit event in the same transaction, so an audit write failure rolls back the operation. MySQL triggers reject audit row updates and deletes, including attempts made outside Prisma. Events include task status changes and assignments, role changes, exports, AI suggestion decisions, and RAG retrieval provenance (`query`, `hitIds`, `durationMs`, `degraded`).

`GET /api/audit` is restricted to ADMIN and QA. The `projectId` column scopes logs directly and is indexed; migration backfills project ownership for known task, requirement, test, document, suggestion, and sync-failure records. User/permission events remain global. The query page is at `/audit`.

If an audit insert fails, the associated business transaction aborts. RAG callers must not return/use retrieved context if provenance cannot be persisted. The database stores the full retrieval query as required for traceability; upstream input handling must continue to reject real PHI.
