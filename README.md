# MedPM-AI

面向医疗软件交付的 AI 原生合规与效率平台。AI 辅助 WBS 分解与工期预估、合规审计追踪、资源冲突与风险预警；建议默认待确认，关键决策可追溯。本项目仅用于合成数据，禁止录入真实患者信息（PHI）。

当前交付范围、模块审阅顺序、迁移和验证证据见 [本地 PR 文稿](docs/local-pr-delivery-workflows.md)。本轮变更保存在 `codex/delivery-workflows-review`，按用户要求仅在本地整理。

## 技术栈

Next.js 15 App Router、TypeScript strict、Tailwind CSS、shadcn/ui 基础配置、Prisma + MySQL 8、Milvus、MinIO、MinerU 云端 v4 异步解析、Vitest 和 Docker Compose。Redis 作为可选异步任务服务。

## 本地启动

1. 安装 Node.js 20.9+ 和 pnpm 10。
2. 复制 `.env.example` 为 `.env`，按文件注释生成并设置 `SESSION_SECRET`（至少 32 个随机字节）。示例数据库凭据仅用于本地开发；部署前必须替换所有密码。
3. 启动依赖：

   ```powershell
   docker compose up -d mysql etcd minio milvus
   ```

4. 安装依赖并应用初始 Prisma migration：

   ```bash
   pnpm install
   pnpm db:generate
   pnpm db:deploy
   $env:LOCAL_DEV_SEED_PASSWORD = "set-a-local-password"
   pnpm db:seed
   pnpm vector:init
   pnpm dev
   ```

5. 打开 `http://localhost:4000`。健康 API `http://localhost:4000/api/health` 也要求有效会话；Redis 可按需通过 `docker compose --profile async up -d redis` 启动。`pnpm dev` 使用 4000；生产 `pnpm start` 默认使用 3000，Compose 端口以 `docker-compose.yml` 配置为准。

也可以用 `docker compose up --build` 启动整套服务。schema 更新后，本地用 `pnpm db:migrate --name <migration_name>` 生成并应用 migration，提交生成的 migration 目录；部署时运行 `pnpm db:deploy`。`pnpm db:seed` 通过事务写入固定 ID 的合成样例，可重复运行；`pnpm vector:init` 创建并加载 `documents` collection。第二阶段 migration 附有结构回滚 `down.sql`；它会删除第二阶段新增的数据，只应在可丢弃环境执行。Prisma 不会自动执行 down migration，生产回滚应使用前向修复 migration。

## 认证数据准备

`pnpm db:seed` 通过事务写入固定 ID 的合成样例，可重复运行。认证测试账号密码从 `LOCAL_DEV_SEED_PASSWORD` 读取（至少 8 个字符，不写入源码），账号为 `admin@medpm.local`、`pm@medpm.local`、`member@medpm.local`、`qa@medpm.local`、`pending@medpm.local`、`disabled@medpm.local`。system user 固定 ID 为 `00000000-0000-4000-8000-0000000000f0`，供系统审计事件关联。阶段 1 migration 允许旧账户的 `passwordHash` 暂时为空；数据完成回填后再通过单独 migration 改为必填。

## 关键设计

- RBAC 角色在 Prisma 中先行建模；新增 API 时必须先做权限校验。
- 项目范围隔离已实现：ADMIN 全部可见，负责人默认可见，其余用户需加入项目；成员授权与业务角色共同校验。QA/ADMIN 可导出 CSV 追溯矩阵和 JSON 证据包，MinIO 文件带 SHA-256，生成和下载均记录范围审计。入口位于项目看板，设计与恢复说明见 [项目授权与合规导出](docs/project-access-exports.md)。
- 登录成功/失败事务先锁定对应账号行，使用 READ COMMITTED，密码哈希校验在事务外完成。事务内复核账号状态、锁定和密码哈希，防止验证期间状态变化后创建会话。只对明确回滚的 Prisma P2034 冲突最多尝试三次，耗尽返回 503 和 `Retry-After: 1`；审计写入失败回滚账号和 Session 修改，不发出登录 cookie。
- AI 建议与正式任务分开确认，不能直接将建议当作已批准业务事实。
- `AIRecommendation` 是兼容旧数据的表。当前 WBS 和风险流程使用 `AiSuggestion`，默认 `PENDING`；人工确认在同一事务中记录审核人、结果及审计事件。
- `AuditLog` 保留 actor、action、entity、before/after、IP、user agent 和毫秒时间戳字段。涉及 MySQL 写入应在同一事务内写业务变更和审计记录。
- 已实现注册、bcrypt 密码登录、退出、个人资料和修改密码。数据库 Session 保存凭证哈希，HttpOnly cookie 携带会话凭证，服务端从 MySQL 读取当前角色和账号状态；`SESSION_SECRET` 至少 32 字节。保留旧签名 cookie 兼容路径，未认证请求默认返回 401。
- `GET /api/audit` 仅 ADMIN 和 QA 可访问；审计页 `/audit` 支持按项目、操作人、操作类型和时间范围筛选。MySQL triggers 阻止 AuditLog 更新和删除。
- `Project.ownerId` 在升级时允许为空，因为历史项目可能没有可关联的 User；新建项目流程应要求指定负责人。
- `AiSuggestion` 保存输入、输出及 `PENDING` 人工审核状态。原 `AIRecommendation` 表保留兼容已有数据。
- `Requirement`、`TestCase` 与项目形成需求到测试的关系链；`SyncFailure` 留存向量同步失败载荷和重试次数。
- 初始 MySQL migration 位于 `prisma/migrations/20261011000000_init`；主键是 UUID `CHAR(36)`，时间字段是 `DATETIME(3)`，表使用 InnoDB 与 utf8mb4。
- Milvus SDK 仅由 `src/modules/vector` 使用。向量写失败要可重试，检索失败应降级为 MySQL 关键词搜索并记下降级信息。
- `src/modules/vector/documents-collection.ts` 定义 `documents` collection（1536 维向量、HNSW/COSINE）；首次调用 `ensureDocumentsCollection()` 时创建并加载。`pnpm vector:init` 可在部署或本地启动时手动初始化。
- 健康检查返回 MySQL、Milvus、MinIO 的连通状态；Compose 会在启动时创建业务与 Milvus 所需的 MinIO buckets。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 当前可用流程

- `/projects`：全部角色可查看；PM 可创建项目，默认 `PLANNING`，负责人为创建者。项目创建和审计写入同一事务。
- `/projects/<projectId>/board`：任务创建、分配、状态流转，WBS 建议生成与逐条采纳/拒绝，规则风险扫描与人工处理。
- `/projects/<projectId>/traceability`：PM 创建/编辑需求并关联或解除关联项目内任务；QA 创建/编辑需求下的测试用例及结果。ADMIN 和 MEMBER 只读。现有全局角色权限继续适用，尚无项目成员级授权。
- `/tasks/<taskId>`：查看需求、测试用例、任务依赖与任务审计时间线。
- `/projects/<projectId>/planning`：PM 维护开始/截止日期、预计工时、前置依赖及成员周容量；全部角色可读，PM 可写。风险扫描按当前 UTC 周运行，不自动调整排期。
- `/notifications`：PM 的个人风险通知；详情保留原判断依据，已读与风险处置分开。项目看板可启用自动风险扫描，需独立运行 `pnpm risks:worker`，详见 [自动扫描说明](docs/risk-scheduler.md)。
- `/audit`：ADMIN/QA 查询审计、扫描断链、恢复历史摘要和查看原始证据；QA 可确认问题、说明误报、采纳或拒绝摘要。所有摘要默认待确认，模型失败时保留规则结果与原始审计。
- `/users`：ADMIN 创建用户、修改角色、激活/禁用账号；`/profile` 提供修改密码与退出。

API：`POST /api/projects`；`GET/POST/PATCH /api/projects/<projectId>/traceability`。追溯写入体以 `kind` 区分 `requirement`、`testCase`、`task`（task 仅 PATCH）。需求更新携带 `expectedVersion`，测试用例更新携带 `expectedUpdatedAt`，任务关联更新携带 `expectedRequirementId`；并发冲突返回 409。需求编辑递增版本，并在审计 before/after 保存原值；不创建新需求 ID，已有任务和测试仍关联同一需求。当前不提供删除接口，保留追溯历史。

WBS 历史检索对 embedding + Milvus 检索的等待上限为 1500ms，失败、超时或无命中时使用 MySQL 关键词检索，并记录 RAG 审计。该上限不包含 MySQL 查询及持久化耗时，也不会取消已经发出的底层远程请求。关键词命中只持久化补写工作到 `SyncFailure`，响应路径不等待向量补写。

服务恢复后，PM 在追溯页面点击“重试历史任务索引”，或调用 `POST /api/projects/<projectId>/history-sync`。每次最多选取 5 条待同步记录；成功删除失败记录，失败递增计数，累计失败 5 次后需人工排查。历史任务索引目前仍为显式重试；文档索引由常驻文档 worker 处理。重试操作会调用远程 embedding/Milvus，耗时与关键词降级请求独立。

文档 RAG 与 WBS 文档证据接入已实现，2026-10-15 已通过百炼 text-embedding-v4、真实 Milvus 及 qwen-flash 的合成小样本联合验收；验证边界和配置优先级见 [文档 RAG 说明](docs/document-rag.md)。排期与周容量维护已实现，支持跨项目负载与规则风险扫描，口径及限制见 [排期说明](docs/planning-capacity.md)。自动扫描与个人站内通知也已实现，需 PM 明确启用并运行独立 worker。仍未完成：精细工作日历/每日容量、站外通知、合规导出、项目成员级授权及电子签名。文档上传、受控下载和 MinerU 异步解析已实现，同日已通过真实 MinIO 与 MinerU 云端正常链路验收。历史问题见 `docs/known-issues.md`。

## 项目文档：上传与存储阶段

从看板进入“项目文档”，或打开 `/projects/<projectId>/documents`。PM/ADMIN 上传 PDF；项目负责人和获授权成员按系统角色查看列表、下载，ADMIN 可访问全部项目。ADMIN/PM 可恢复中断上传、重试失败对象清理，仍需项目访问权。

上传需明确确认仅含合成数据；最大 20 MB，服务器同时检查文件名、MIME、PDF 文件头及实际请求体大小。文件头校验不能代替解析，后续解析由 MinerU 完成，失败会保留源文件。服务器生成对象 key，不使用用户文件名作为路径。

迁移 `20261015010000_document_upload` 增加上传人、大小、SHA-256、幂等上传标识、上传时间与存储状态。状态为 UPLOADING、AVAILABLE、FAILED；历史记录默认 LEGACY，不自动声称对象已核验。每个阶段写入及审计均在 MySQL 事务内；跨 MySQL/MinIO 不使用伪分布式事务。

- 先创建 UPLOADING 记录与开始审计，再写 MinIO，最后事务确认 AVAILABLE 并写成功审计。
- 失败记录为 FAILED 并将清理工作存入 SyncFailure；清理失败保留记录供人工重试。失败文件可发起新的上传，原失败记录保留。
- 若确认和失败审计都不能提交，保留 UPLOADING 记录与已写对象。超过 10 分钟后 ADMIN/PM 可恢复，核验实际字节大小和 SHA-256；存储不可用时继续保留待恢复状态，不能把服务故障当作对象不存在。
- 同项目同 uploadKey 重试已成功的上传返回原 ID，不重复写对象或审计；不同内容复用标识返回 409。页面“开始新的上传”允许显式更换标识。
- 下载只允许 AVAILABLE，重新核验完整性，并先写 DATA_EXPORTED（操作者、文档 ID、项目、文件名、SHA-256、时间、IP/userAgent），审计失败不发放字节。返回 attachment、no-store 和 nosniff。
- MinIO SDK 每个 HTTP 请求有 15 秒期限并销毁超时请求，禁用其隐式重试；这不是整个上传流程的总时限。存储端是否提交仍可能不确定，FAILED/UPLOADING 记录及确定对象 key 用于后续核验和清理。

接口：`GET/POST /api/projects/<projectId>/documents`（列表每页 20）；`GET /api/documents/<id>`；`GET /api/documents/<id>/download`；`POST /api/documents/<id>/recover`；`POST /api/documents/<id>/cleanup`。multipart 字段为 file、UUID uploadKey、syntheticOnly=true。对象 key 和存储凭据不返回前端。

运行真实存储前启动 `docker compose up -d minio minio-init`，或连接已部署的 MinIO；应用 `pnpm db:deploy`，按 `.env.example` 配置 MinIO，再运行 `pnpm dev`。2026-10-15 已使用 `.env` 配置的局域网真实 MinIO 验证健康接口 200、bucket 存在、凭据可用，以及 PM 上传 → QA 下载字节一致 → 导出审计留存。沙箱访问该局域网地址曾返回 EACCES，使用允许访问该地址的执行环境后通过；本机 Docker Engine 是否运行不影响远程部署的验证。该验收未对真实 MinIO 注入故障，也未测试重启后的数据持久性；失败恢复路径由隔离测试覆盖。

验证命令：

```bash
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/documents.test.ts
node scripts/test-documents-e2e.mjs
```

前者使用随机隔离本地 MySQL 数据库及注入存储适配器，验证事务、失败恢复与回滚。后者启动仅用于测试的内存 S3 协议服务和独立 Next 开发服务，浏览器通过实际 MinIO SDK 完成上传/下载及故障路径；不验证真实 MinIO 的部署、鉴权或持久化。也可启动真实服务后设置 E2E_BASE_URL，运行 `pnpm exec playwright test e2e/documents.spec.ts --workers=1` 完成真实联调。浏览器测试保留合成业务数据与审计，清理自身 Session。

## MinerU 异步解析

本阶段接入 [MinerU 云端 v4 官方接口](https://mineru.net/apiManage/docs)，不是自托管 `/v1/*` 接口。PM/ADMIN 在项目文档页明确确认发送合成 PDF 到云端后提交任务；已登录且获授权的项目用户按角色查看状态、历史版本和预览。原始 PDF 不被修改，解析结果不创建正式任务或改变业务状态。

先配置被 Git 忽略的 `.env`：MINERU_BASE_URL=https://mineru.net/api/v4、MINERU_API_KEY、MINERU_MODEL_VERSION=vlm（也支持 pipeline）。示例文件只保留空密钥。迁移 `20261015020000_document_parse_jobs` 增加 Document 解析状态和版本，以及 DocumentParseJob 持久化队列；历史记录默认 NOT_REQUESTED，不把旧 parsedText 自动当作已验证的新版本。运行 `pnpm db:generate`、`pnpm db:deploy` 并确保 seed 中的 system user 存在；分别启动 `pnpm dev` 和 `pnpm documents:worker`。`pnpm documents:worker --once` 执行一次领取/处理步骤，完整任务至少经历申请链接、上传、轮询三个步骤。

Compose 可用 `docker compose --profile parse up -d document-worker` 启动相同应用镜像内的独立 worker 进程，复用 MySQL 和 MinIO。worker 使用现有 TypeScript 工具链进行运行时转译；`pnpm typecheck` 是独立的必需检查，镜像需保留 TypeScript 依赖。没有新增 Redis 或独立业务服务。

- `POST /api/documents/<id>/parse`：提交解析；`POST /api/documents/<id>/retry`：仅重试 FAILED 文档。JSON 必须包含 UUID requestKey、expectedVersion、cloudProcessingConfirmed=true；返回 202，不等待远程处理。相同请求键返回原任务，竞争请求或旧版本返回 409。
- `GET /api/documents/<id>/parse`：最近 20 个解析版本的任务状态，不返回临时上传 URL、存储 key 或凭据。
- `GET /api/documents/<id>/preview?version=1`：成功版本预览，默认上一次成功版本；Markdown 以文本展示，不执行 HTML。最多展示 20 万字符及 200 个内容块（每块 2000 字符），截断时明确提示。完整内容仍保存在数据库和原始结果包。

worker 每 2 秒领取任务，以 3 分钟租约及随机 token 防止多 worker 重复发布结果。步骤和 batch ID 持久化，重启后继续原步骤；申请云端上传链接后先保存再上传，后续轮询不重复提交文件。提交已被云端接受、但 batch ID 尚未成功保存时仍可能出现远程重复任务；不能宣称跨云端恰好一次，本地版本和租约保证只有有效结果能发布。

任务从提交开始有 30 分钟总期限。网络和服务端临时失败累计最多三次处理尝试，认证/协议/结果错误直接失败；审计或数据库故障导致状态事务回滚，过期租约可再次领取。未运行 worker 时任务保持排队。失败重试创建新版本，旧成功文本及原始结果包保留。

云端链路为申请预签名上传地址 → PUT 原 PDF → 轮询 batch → 下载 ZIP；文件上传和结果下载不携带 MinerU API Key。传输只允许配置服务同源地址，或 HTTPS 下的 MinerU/OpenXLab/Aliyun 域名；下载重定向逐跳检查。源 PDF 上传前重新核验大小和 SHA-256；原始结果 ZIP 保存到 MinIO，结果 SHA-256、API v4 标识、模型选择和来源哈希可追溯。vlm/pipeline 是云端模型标签，并不是固定的模型权重版本。

ZIP 下载最多 32 MB，只在内存解包 Markdown 和 content_list JSON，每个目标文件最多 8 MB，目标解包合计最多 16 MB、归档最多 1024 项。结构化页码来自 page_idx + 1；没有页码时保留 null，不推测页码。结果保存失败的归档会登记 SyncFailure，worker 延后清理未引用结果，已成功引用的归档保留。清理累计失败五次后保留待人工排查记录。

审计包含申请、执行步骤、成功、失败和孤立归档清理；用户触发事件使用实际 actor，worker 事件使用 system actor 并保留 requestedById。密钥、预签名 URL、服务原始错误正文不进入审计或前端。只使用合成数据；云端权限及费用策略以实际账号为准。

验证：`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/document-parsing.test.ts` 使用隔离 MySQL 和注入服务验证租约恢复、失败重试、审计回滚与迁移回滚。已于 2026-10-15 用真实 MinIO、MinerU 云端、独立 worker 和合成单页 PDF 通过浏览器验收。复现时启动应用及 worker，设置 E2E_BASE_URL 后运行 `pnpm exec playwright test e2e/document-parsing.spec.ts --workers=1`；该测试会实际提交一份合成 PDF 并保留合成数据及审计，清理自身 Session。

## 静态检查与回归

`pnpm lint`、`pnpm typecheck`、`pnpm test` 验证静态检查和单元测试；真实数据库 HTTP 集成测试用 `pnpm test:integration:auth`，浏览器回归用 `pnpm test:e2e`，需先启动依赖、应用迁移并准备合成账号。测试成功与服务运行状态应分别验证。E2E 会保留合成业务数据及审计记录，只应在可丢弃的测试环境运行。

## 合规扫描与复核

迁移 `20261015000000_compliance_review` 为 Task、TestCase 增加可空的已复核需求版本、复核人及时间，并新增 `ComplianceFindingReview`。历史 NULL 保持“未复核”，不会自动回填为已通过。QA 在追溯页面确认任务或测试适配当前需求版本；需求编辑递增版本后旧复核过期，重新关联任务、修改测试标题会清空相应复核。通过测试或更新任务状态不能替代版本复核。

扫描包含六类规则：任务缺需求、已批准需求缺任务、未退役需求缺测试、完成任务测试未通过、任务版本未复核/过期、测试版本未复核/过期。规则结果独立保存，LLM 仅提供解释性摘要；即使模型返回空异常，规则发现仍会显示。缺少来源审计时明确提示，不编造引用。

`POST /api/audit/summary` 扫描当前业务快照；操作人、时间筛选仅限制审计事件，不重建历史业务状态。每类业务实体在同一事务中分页读取，上限 5000 条，超出时明确标记覆盖不完整；审计来源最多 100 条并标记截断。每个问题展示最多 30 项业务引用，超出时提示补查。模型输入只包含受限证据，全部规则发现和扫描快照保存在摘要记录中。

- `GET /api/audit/summaries?projectId=<UUID>&page=1`：每页 20 项历史摘要。
- `GET/PATCH /api/audit/summaries/<suggestionId>`：查看原始扫描；QA 提交 `decision=ACCEPTED/REJECTED` 与必填 `note`。
- `POST /api/audit/summaries/<suggestionId>/findings/<findingKey>/review`：QA 提交 `CONFIRMED/DISMISSED` 与说明；同一扫描同一问题只复核一次。
- `POST /api/projects/<projectId>/compliance/requirement-reviews`：QA 提交实体类型/ID、预期需求 ID/版本、记录的 `expectedUpdatedAt` 与说明；记录或关联变化时拒绝旧页面提交。
- `GET /api/audit/<auditId>` 或 `/audit/records/<auditId>`：ADMIN/QA 查看原始证据。

复核、摘要确认与审计同事务，重复确认或版本变化返回 409。采纳摘要不等于允许发布；确认问题不会自动修改任务或测试状态，整改后需要重新扫描。ADMIN 可扫描和查看，只有有效 QA 账号可复核。版本复核不是电子签名或法规认证。

合规数据库集成测试：`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/compliance.test.ts`，使用随机隔离本地 MySQL 数据库，结束后删除该测试库；需配置本地 `DATABASE_URL` 和 `MYSQL_ROOT_PASSWORD`。覆盖迁移回滚、并发确认、跨项目拦截和审计失败事务回滚。浏览器流程：`pnpm exec playwright test e2e/compliance.spec.ts --workers=1`；可复用已启动服务，通过 `E2E_BASE_URL=http://localhost:4000` 避开已知 Windows 关闭卡住问题。
