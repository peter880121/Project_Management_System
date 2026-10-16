# 第 08 阶段代码审查（2026-10-16）

审查基于 `codex/01-initialize-project` 分支当前工作区，包括未跟踪的新增实现、测试和迁移；不是只审查 `git diff` 中已跟踪的文件。保留已有修改，未提交、合并或修改本地业务库结构。本轮修复不引入依赖、环境变量、数据库迁移或 Milvus 字段。

后续本地整理已在 `codex/delivery-workflows-review` 分支完成登录、用户身份保护及完整交付功能提交；用户要求仅放本地。下文“未提交”描述的是审查阶段状态，最终提交分组和 PR 正文见 [本地 PR 文稿](local-pr-delivery-workflows.md)。

## 严重问题（必须修）

### P1：请求开始时的角色授权可在事务提交前失效——已修复

`createTask`、WBS 采纳/拒绝、风险处理、项目创建、追溯维护，以及 WBS/合规摘要生成持久化，原先依赖 API 入口的角色检查。管理员在该检查后撤销 PM/QA 角色，而账号仍为 ACTIVE 且仍拥有项目访问权时，`recordAudit` 的项目授权检查不能阻止越角色提交。项目授权不等于操作角色授权。

修复：`src/modules/auth/project-access.ts` 新增 `lockBusinessActor`，参数化锁定 User 行，检查当前角色、ACTIVE 状态和非系统身份。在上述业务事务内调用；保留原有项目撤权复核及业务/审计原子性。WBS 通用复核入口也校验建议类型，避免误处理其他 Agent 建议。任务、WBS、风险复核 API 将事务内权限拒绝返回 403。

业务取舍：角色变更和业务提交通过同一用户行锁排序。如果撤权先完成，业务操作拒绝；如果业务已经取得锁并提交，撤权随后生效，不改写历史。锁冲突不会降级为跳过权限或审计。

验证：隔离 MySQL 测试在保留项目访问权的情况下，将 PM 降为 MEMBER，验证创建任务/项目、维护需求/测试、分配、采纳/拒绝 WBS、处理风险均返回权限错误，不新增业务或成功审计记录。现有正向集成测试和浏览器流程验证合法角色仍可操作。

### P1：MEMBER 可以在任务重新分配后提交旧请求——已修复

`src/app/api/tasks/[taskId]/route.ts` 在事务外检查负责人及已完成状态；`changeTaskStatus` 原先只按任务 ID 和状态执行条件更新。任务被 PM 重新分配但状态未变时，旧负责人仍可能更新状态。

修复：在事务内按锁定的当前角色复核任务负责人及 DONE 保护；MEMBER 的条件更新同时要求 `assigneeId === actorId`。任务已分配给别人时整笔回滚，不写成功审计。

验证：初轮用真实 MySQL 测试覆盖读取后重新分配时的条件更新保护。统一项目锁后，最终用例通过 query extension 暂停 MEMBER 事务，让 PM 分配请求到达项目锁，再释放事务；两者按序提交，成功状态审计仅一条，重新分配后的原成员后续写入被拒绝。另覆盖合法成员开始/完成任务及禁止重新打开 DONE。

## 中等问题（建议修）

### P2：不同写入路径的锁顺序不一致——后续收口已修复

位置：`auth/project-access.ts` 的 `assertProjectAccessTx`、`audit/service.ts` 的 `recordAudit`、`ai/risk/worker.ts` 的 claim/execute、`documents/parse-worker.ts` 的 claim/publish。

部分业务先锁 User 再锁 Project，审计辅助函数先锁 Project 再锁 User；worker 又可能先更新 Job/Document，再在审计时锁 Project，而其他执行路径先锁 Project 再更新 Job。存在形成锁环的条件。这是静态分析风险，本轮未采集新的 InnoDB 死锁图，不能把历史任务列表 500 归因于它。

建议修复：先制定覆盖 HTTP 与 worker 的统一锁顺序，并为授权、队列领取和提交建立独立复现用例；只对明确回滚的 P2034 做有限重试。禁止对已发生远端上传/模型调用的整段流程盲目重放。失败时保持回滚，返回可重试错误；worker 依靠持久任务和过期租约恢复。该项涉及多个模块，应作为独立修复批次审阅。

用户批准后已实施 Project → UUID 排序的 User → 业务记录的锁协议，覆盖任务、排期、项目成员、导出、AI 复核、解析和索引 worker。补充项目锁竞争的确定性门闩测试；已识别的 HTTP/worker 逆序已移除。未新增整段重试，不把“降低锁环风险”扩大为“已消除所有数据库死锁”。实现与取舍见 [事务锁与安全错误响应](transaction-locking.md)。

### P2：部分任务和 AI 复核路由返回原始异常消息——后续收口已修复

位置：`src/app/api/tasks/[taskId]/route.ts`、`src/app/api/ai/wbs/[suggestionId]/route.ts`、`src/app/api/ai/risk/[suggestionId]/route.ts`。catch 中直接输出任意 `Error.message` 并通常返回 409。基础设施异常可能暴露 Prisma 调用或数据库细节，也会被误判成业务冲突；本轮新增权限错误已单独映射 403。

建议修复 diff 方向：为预期的业务拒绝使用明确的领域错误；只将这类错误的安全文案返回客户端。已知事务冲突映射 409/503，其余异常记录脱敏上下文并统一返回 500。复用项目/文档/排期现有错误处理思路，不将所有 Error 当作可展示文案。补真实审计失败的 HTTP 响应断言。

已新增 BusinessError 和共享错误映射。任务创建/分配/状态、WBS 采纳/拒绝、风险处理在真实 MySQL 审计触发器故障下均返回固定 500；业务变更与成功审计全部回滚。P2034/P2002 返回固定 409，明确权限和业务拒绝保留指定状态；其余任意异常消息不进入响应。

### P2：AI 建议采纳后缺少可审计的业务撤回流程——设计缺口

`acceptWbsSuggestion` 的失败回滚和并发去重已具备，但成功采纳后没有完整的反向业务操作。事务失败回滚不能代替成功采纳后的人工撤回。

建议下一设计批次明确：未开始、未被引用的 AI 任务能否撤销；已经执行或成为前置依赖的任务如何走补偿变更；保存原建议、任务关联、操作者、原因、before/after，禁止删除审计。该项可能新增状态、字段和 API，本轮未擅自扩展数据模型。

## 轻微问题（可选）

- 三份文档 E2E fixture 未随项目隔离补充授权，QA 无法到达待测试流程。已为文档上传/解析 fixture 添加 QA 项目成员；RAG fixture 指定 PM owner 并添加 QA。RAG/云解析仍依赖 worker，不能仅凭 fixture 修正宣称外部链路已通过。
- `src/modules/ai/README.md` 对文档证据、后台风险扫描、历史同步方式、去重规则及扫描上限的描述过期，已按当前实现同步。
- `test:integration:auth` 实际包含所有 integration 文件，名称容易误导；建议后续整理脚本命名。
- `docs/项目详细说明.md` 部分历史段落仍称文档/导出未完成，应与分模块验收文档统一状态说明。

## 其余审查结论与边界

- 新增七组 migration 均有 down.sql，使用 MySQL JSON、UUID char(36)、DATETIME(3)、utf8mb4/InnoDB；相关集成套件验证结构回滚和审计保留。down.sql 不由 Prisma 自动执行，删除新增字段/表仍会损失对应业务元数据，必须停服务、备份并按逆序规划恢复。
- 本地 `prisma migrate status`：12 组迁移全部应用。该命令不证明生产部署或完整 schema drift 验收。
- 导出范围、操作者、时间、内容哈希有审计；对象写入后及下载读取后再次鉴权，审计失败不返回文件。JSON 当前业务快照与审计时间过滤的区别已明确；CSV 有公式转义和数量/体积上限。
- 检索先通过 vector 封装，Milvus filter 中动态 ID 经 UUID 校验；失败回退参数化 MySQL 关键词检索，记录 query、命中、耗时、降级。源码中未发现业务模块直接引入 Milvus SDK；MinIO SDK 位于 documents/storage 封装。
- 文档向量写入失败保留重试记录；MinerU 失败有持久状态和重试，不能自动解析时仍需人工处理/任务录入，不等同于已实现第二解析引擎。
- WBS、风险、合规摘要创建时保持 PENDING，生成不自动写 Task；采纳 WBS 才创建正式任务；风险处理不修改任务状态。
- 源码、脚本、Prisma、文档中未发现常见 API Key/私钥格式匹配或生产调试 console.log、ts-ignore/ts-nocheck。模式扫描不是完整秘密检测，也不证明不存在 PHI；文档仍以合成数据确认和操作约束为边界。
- 本次未做依赖漏洞数据库审计、真实模型质量评估、真实 MinerU 云联调或生产 Docker 全链路部署。

## 验证记录

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm test`：54 个文件、349 项通过。
- `pnpm build`：优化生产构建、类型检查和页面生成通过；构建完成不等于容器部署验收。
- 最终 `git diff --check` 与再次执行的 `pnpm typecheck`：通过。
- 全部集成套件基线：103 项通过，2 项可选联调跳过；修复后受影响的授权/导出、文档 RAG、合规套件重跑：32 项通过、1 项跳过。新增 3 项授权用例，授权/导出套件从 14 项增为 17 项。
- `docker compose config -q`：通过。沙箱读取 Docker 配置曾被拒绝，获准重跑后完成。
- 浏览器回归：合规复核、排期容量、任务流转、追溯维护四项通过；获准启动可访问 MinIO 的临时服务后，文档上传/下载和项目成员授权/CSV/JSON 导出/撤权两项通过，累计六项。文档用例本次未启用协议 fixture 的失败注入分支；云解析和 RAG 浏览器用例未重跑。
- 初次导出下载因沙箱对 MinIO 的 EACCES 超时；获准的 MinIO 健康检查为 HTTP 200，重跑导出用例通过。初次测试服务关闭卡住后已中断并检查无遗留 Next.js 进程；重跑使用显式 E2E_BASE_URL，完成后已停止临时服务。

## 本轮修改文件

- `src/modules/auth/project-access.ts`
- `src/modules/audit/service.ts`
- `src/modules/projects/services.ts`、`services.test.ts`
- `src/modules/ai/wbs/service.ts`
- `src/modules/ai/compliance-audit/service.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/ai/wbs/[suggestionId]/route.ts`
- `src/app/api/ai/risk/[suggestionId]/route.ts`
- `tests/integration/project-access-exports.test.ts`
- `e2e/documents.spec.ts`、`document-parsing.spec.ts`、`document-rag.spec.ts`
- `src/modules/ai/README.md`
- `docs/known-issues.md`
- 本报告。

建议独立提交标题：`fix(auth): revalidate business permissions inside transactions`。既有工作区还含多个功能阶段的未提交改动，提交前须分组审阅，不应将整份工作区直接作为这个修复提交。

## 后续收口与第 09 阶段检查

已读取 `docx/prompts/09-提交前检查.md`。锁顺序和安全错误响应两项 P2 已实施，并在 UUID 边界复核中修复用户管理大写 UUID 绕过本人角色/状态修改保护的问题。详细修改文件、锁协议和取舍见 [事务锁与安全错误响应](transaction-locking.md)。

最终验证：

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 为 55 个文件、357 项通过。
- 全量集成回归 108 项通过、2 项可选外部联调跳过；最终 UUID 边界修复后，用户管理 9 项真实 HTTP 测试再次通过，包含本人角色/状态的大写 UUID 请求。
- 6 项浏览器回归全部通过：合规复核、文档上传/QA 下载、排期容量、成员授权/CSV/JSON 导出及撤权、任务流转、追溯维护。使用真实本地应用/MySQL/MinIO；云解析和 RAG 浏览器用例未重跑。
- 生产 build 首轮及最终 UUID 修复后的重跑均通过（编译、类型检查、页面生成和构建追踪完成）。
- `git diff --check` 通过；扫描未发现生产源码/脚本中的 console.log、ts-ignore/ts-nocheck 或常见 API Key/私钥格式。无新增依赖、数据库迁移、环境变量或 Milvus 字段，因此本轮无需调整 down.sql、`.env.example` 或 collection 初始化。
- 关键写入仍由相同事务内的审计保护；WBS、风险、合规摘要生成仍保持 PENDING。SQL 审计失败的路由测试证明不能返回成功或泄露原始错误。
- 临时开发服务已关闭。保留原工作分支与已有未提交改动，没有自动提交、推送或合并。

剩余风险：同项目写入串行、系统 worker 用户行的共享锁可能限制吞吐；这些测试不能证明所有死锁已消除，历史任务列表 500 仍未找到根因。AI 成功采纳后的业务撤回流程、真实外部联调、生产容器部署仍需独立验收。

建议本批提交标题：`fix(transactions): standardize lock order and sanitize business errors`。旧工作区含多个功能阶段，后续应先按依赖和业务模块分组，再准备 PR。
