# 合规 Agent 断链检查与 QA 复核闭环实施方案

状态：已确认并实施；验证结果以本次交付报告为准。沿用当前模块化单体，不增加依赖。

## 当前缺口

- 扫描跳过未关联需求的任务，只检查已完成任务的测试结果和更新时间差。
- LLM 可以返回空异常列表，覆盖规则已经发现的问题；规则结果必须独立保存和展示。
- Task、TestCase 尚无已复核需求版本，更新时间不能证明已适配新需求。
- 摘要只有生成审计，没有独立待确认记录、问题复核及摘要确认入口。
- 查询固定截取任务 500、需求 500、测试 1000、审计 100 条，未告知扫描是否完整。

## 业务范围与权限

- ADMIN、QA 可扫描、查看摘要及其引用；QA 可复核具体问题、确认需求版本、采纳或拒绝摘要。
- PM、MEMBER 不可调用合规扫描或复核 API；PM 继续通过现有入口修正需求和任务关联。
- 问题复核与业务整改分开：确认问题或说明误报不会自动改变任务、需求、测试状态。
- 采纳摘要表示认可本次扫描结论，不表示项目已合规或允许发布。

## 数据模型与迁移

1. Task、TestCase 各新增可空字段：
   - reviewedRequirementVersion：UnsignedInt，已人工复核的需求版本。
   - requirementReviewedById：UUID CHAR(36)，关联 User，删除限制 Restrict。
   - requirementReviewedAt：DATETIME(3)，UTC。
   - User 增加对应命名反向关系。
2. 复用 AiSuggestion：type=AUDIT_SUMMARY，status=PENDING。
   - input 保存扫描范围、规则版本、扫描时间、覆盖情况和用于判断的业务快照。
   - output 保存确定性 findings、解释性摘要、来源审计 ID、模型标识和降级信息。
   - 确认只更新 status、reviewedById、reviewedAt；不覆盖原始输出。
3. 新增 ComplianceFindingReview：
   - id、suggestionId、findingKey、decision（CONFIRMED/DISMISSED）、note、reviewedById、createdAt。
   - 主键及外键 UUID CHAR(36)，note 有长度限制，时间 DATETIME(3)，UTC。
   - suggestionId + findingKey 唯一；同一次扫描的每个问题只提交一次正式结论，后续变化通过新扫描复核。
   - 外键 Restrict，禁止通过应用接口修改或删除复核记录；复核与审计同事务。
4. 提供命名 migration 和结构回滚 down.sql。
   - 不回填历史记录为“已复核”；现有数据保留 NULL，扫描提示待复核。
   - 回滚会删除新增复核数据及版本字段，只用于可丢弃环境；不删除 AuditLog。

## 规则与扫描语义

规则至少包括：

- TASK_WITHOUT_REQUIREMENT：任务未关联需求。
- APPROVED_REQUIREMENT_WITHOUT_TASK：已批准需求没有任务。
- REQUIREMENT_WITHOUT_TEST：未退役需求没有测试用例。
- DONE_TASK_WITH_UNPASSED_TEST：完成任务的需求存在未通过测试。
- TASK_REQUIREMENT_REVIEW_STALE：任务未复核或已复核版本与当前需求版本不一致。
- TEST_REQUIREMENT_REVIEW_STALE：测试用例未复核或已复核版本与当前需求版本不一致。

每个 finding 包含稳定规则代码、findingKey、实体和需求版本、业务引用、可用的审计引用和证据。没有来源审计时明确标记来源缺失，不编造 ID。规则结果不交给 LLM 决定是否保留。

扫描是当前业务快照检查；时间和操作人筛选限制审计摘要来源，不伪装成历史时点重建。分页读取同一事务快照；达到安全上限时显式返回覆盖不完整、记录数量及待补查提示，不能返回“全部通过”。只把受限证据输入 LLM，完整规则结果仍留存。

## 版本复核与并发

- QA 提交 entityType、entityId、expectedRequirementId、expectedRequirementVersion、expectedUpdatedAt 和说明，拒绝旧页面对已经修改的记录进行复核。
- 事务中校验项目归属、当前关联、需求版本及操作者角色；冲突返回 409。
- 新建任务、测试不自动视为已复核；任务重新关联需求时清空版本复核字段，测试标题修改时也清空。
- 需求版本递增后，历史复核自然过期，不重写旧复核审计；普通状态更新不能使过期复核重新有效。
- 新的通过测试结果不能替代需求版本复核。

## API 与页面

- POST /api/audit/summary：扩展现有扫描，持久化 PENDING 摘要及生成审计。
- GET /api/audit/summaries?projectId=...：分页查询可恢复的历史摘要。
- GET /api/audit/summaries/[suggestionId]：查看原始扫描、证据、复核结论和状态。
- PATCH /api/audit/summaries/[suggestionId]：QA 采纳/拒绝，必须提供说明；条件更新防重复确认。
- POST /api/audit/summaries/[suggestionId]/findings/[findingKey]/review：QA 确认问题或说明误报。
- POST /api/projects/[projectId]/compliance/requirement-reviews：QA 明确复核任务或测试适配的需求版本。
- GET /api/audit/[auditId]：ADMIN/QA 查看引用原始审计，避免引用超出当前列表时无法访问。
- /audit 扩展历史摘要、待确认状态、独立规则发现、复核表单及原始审计引用。
- 追溯页面显示当前版本、已复核版本、过期提示和 QA 版本复核入口。

所有 API 输入用 Zod 校验；业务逻辑放 services，数据访问放 repositories，写入及审计同事务。不新增自动修改业务状态的能力。

## 文件范围

- prisma/schema.prisma、prisma/migrations/<timestamp>_compliance_review/{migration.sql,down.sql}
- src/modules/ai/compliance-audit/{types,rules,repositories,service,review-service,prompt}.ts 及对应测试
- src/modules/audit/service.ts：新增审计 action
- src/modules/projects/{services,repositories}.ts：关联与内容变更时失效版本复核
- src/app/api/audit/**、src/app/api/projects/[projectId]/compliance/**
- src/app/audit/**、src/app/projects/[projectId]/traceability/**
- e2e/compliance.spec.ts、相关数据库集成测试、README.md

## 验收

- 完整链路无误报；六类断链和未复核/过期情况均可复现。
- 模型失败、超时、伪造引用或省略异常时，确定性发现和原始审计仍可用。
- PM/MEMBER 无权扫描或复核；QA 可完成闭环；ADMIN 可扫描和查看。
- 数据变化与并发复核产生 409，不误确认新版本；重复摘要确认不产生重复写入。
- 复核说明、操作者、时间、原始证据及前后值可追溯；审计失败导致业务事务回滚。
- 摘要默认待确认，采纳/拒绝或问题复核不自动修改业务状态。
- 覆盖不完整时明确提示；引用点击可打开原始记录。
- 使用合成项目运行数据库集成测试和 Playwright；运行 pnpm lint、pnpm typecheck、pnpm test。

## 风险与降级

- 历史 NULL 会产生待复核提示，这是避免误判旧数据已合规的明确取舍。
- 版本对齐只是人工确认依据，不等于电子签名、测试执行证明或法规认证。
- 模型不可用时保留规则结果和原始审计；数据库或审计写入失败时不返回成功。
- 当前保留全局角色授权，项目成员级隔离不属于本次范围。
- 正常路径、失败路径与浏览器验收全部完成后，再单独考虑文档 RAG 和合规导出。
