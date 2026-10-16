# 项目授权与合规证据导出

## 业务边界

系统角色决定可执行的操作，项目授权决定可访问的数据。ADMIN 可访问全部项目；项目负责人默认可访问；PM、QA、MEMBER 需加入对应项目。加入项目不会提升系统角色。仅项目负责人中的 PM 或 ADMIN 可以添加、移出成员，授权变更带版本检查并记录审计。

项目列表、看板、任务详情、追溯维护、排期、文档及 RAG 引用、AI 建议、风险任务、个人通知、审计详情均检查项目范围。QA 的审计列表仅返回获授权项目的事件，系统级审计由 ADMIN 查看。其他项目的资源占用只以总工时和数量参与容量计算，不返回其他项目或任务 ID；旧风险容量快照在读取时也过滤关联 ID。

项目写入事务先锁项目，再按 UUID 顺序锁涉及的用户，然后处理成员授权和业务记录；审计提交前仍以当前读取复核角色、账号状态和成员授权，避免 MySQL RepeatableRead 使用旧授权。并发撤权先提交则业务变更回滚；已提交的业务变更仍保留历史证据。锁冲突可能产生可重试的事务失败。已获授权的请求返回后，系统无法撤回用户已经下载的数据。详见 [事务锁协议](transaction-locking.md)。

## 页面和 API

项目看板提供“项目成员”入口；QA 和 ADMIN 另可进入“合规导出”。

| API | 用途 |
| --- | --- |
| `GET /api/projects/:projectId/members` | 成员清单；可管理者另获候选用户 |
| `PUT /api/projects/:projectId/members` | `{userId, active, expectedVersion}`；新授权版本为 0 |
| `GET /api/projects/:projectId/exports` | 最近 20 个导出记录，不返回对象存储键 |
| `POST /api/projects/:projectId/exports` | QA/ADMIN 创建并下载；`requestKey` UUID、`format: csv/json`、可选 UTC `from/to` |
| `GET /api/exports/:id/download` | 重查项目权限和 SHA-256 后下载，单独记录审计 |
| `POST /api/exports/:id/cleanup` | QA/ADMIN 清理失败或中断超过十分钟的文件 |

CSV 是含 BOM 的需求—任务—测试矩阵，保留缺失关联和未关联需求的任务；公式开头加单引号，字段按 CSV 规则转义。一个需求对应多个任务与测试时，矩阵为这些关联的组合。JSON 包含当前需求、任务、测试、项目审计事件及最近审计摘要。**时间范围仅过滤审计事件，业务数据为当前一致性快照，并非历史状态还原。** 最近摘要保留原生成时间和待确认/已复核状态，可能早于当前业务快照。两种报告都不是发布批准、电子签名或法规认证。

## 失败与恢复

1. MySQL 一致性事务保存 GENERATING 记录、范围、数量、操作者、文件大小、SHA-256 和准备审计。
2. 在事务外保存 MinIO 文件，避免对象存储故障占用长数据库事务。
3. 再次检查导出权限，在同一事务标记 AVAILABLE 并写 DATA_EXPORTED，然后返回文件。
4. 存储或最终授权/审计失败时不返回文件；记录 FAILED 和 `MINIO_EXPORT_CLEANUP` 工作项，支持页面清理。数据库整体不可用时可能保留 GENERATING，十分钟后可人工清理。

同一项目的相同 requestKey 和范围可复用已完成文件，重复下载仍单独审计；失败请求需新 requestKey。每类实体上限 5000 条，CSV 组合上限 20000 行，文件上限 10 MiB，超限返回 422 而不静默截断。大项目后续应增加异步分页导出。下载验证文件长度和 SHA-256；MinIO 故障及文件损坏不返回不完整证据。

## 迁移与兼容

`20261015060000_project_members_compliance_exports` 新建 ProjectMember、ComplianceExport，回填历史项目负责人和已有任务负责人。不会给全部用户授权：历史 QA、协作 PM 需由负责人或 ADMIN 明确添加；没有负责人的旧项目由 ADMIN 管理。迁移回填是初始授权基线，后续授权变更均记审计。合成 seed 显式添加演示 PM/MEMBER/QA，重复执行不会重新启用被撤销的授权。

`down.sql` 保留审计表但删除成员授权和导出元数据，应先备份、处理 MinIO 对象，并停用应用及 worker。在隔离测试库验证结构回滚；生产优先前向修复。**回滚到旧应用会失去项目隔离，不能当作无风险的功能开关。** 本次不新增依赖、环境变量或 Milvus 字段。

## 主要变更文件

- `prisma/schema.prisma`、本阶段 migration：授权与导出模型。
- `src/modules/auth/project-access.ts`、`project-scope-http.ts`：查询范围与事务复核。
- `src/modules/projects/members.ts`：授权版本、负责人保护、审计。
- `src/modules/exports/`、`src/modules/documents/storage.ts`：报告、持久化、MinIO 与恢复。
- `src/app/api/` 相关项目与实体路由、项目/任务/审计页面：入口鉴权。
- `src/modules/planning/`、`src/modules/ai/risk/`：跨项目容量隐私及通知隔离。
- `src/app/projects/[projectId]/members/`、`exports/`：成员维护和导出页面。
- `tests/integration/project-access-exports.test.ts`、`src/modules/exports/report.test.ts`、`e2e/project-access-exports.spec.ts`：成功路径、越权、并发撤权、审计/存储故障和浏览器下载。

只使用合成数据；当前没有 PHI 自动识别、签名、保留策略或不可变对象存储保证。权限撤销阻止后续访问，不删除历史审计和既有任务。

## 本轮验证（2026-10-15）

- `pnpm lint`、`pnpm typecheck`、`pnpm test` 通过，54 个单元测试文件、349 项用例。
- 集成回归累计 103 项通过，2 项可选外部联调用例未启用。其中本阶段隔离 MySQL 用例 14 项，覆盖授权范围、间接实体 URL、RepeatableRead 旧授权、成员/导出审计回滚、上传与下载期间撤权、损坏对象、遗留准备记录清理及 migration 回滚/回填；风险计划回归 12 项含配置人撤权后自动停用。
- 5 项浏览器验收通过：合规摘要复核、排期容量、需求测试维护、新成员授权/CSV/JSON 下载及撤权、独立 worker 风险通知。导出用例连接配置中的真实 MinIO，下载内容与数据库 SHA-256 相符。
- 首次 HTTP/浏览器并发执行因共享 `.next` 出现构建冲突，受影响的注册和用户管理共 15 项 HTTP 测试已串行重跑通过；浏览器用例亦串行通过。沙箱访问 MinIO 曾返回 EACCES，获准放行临时测试服务后完成真实下载。
- 本地 12 个 migration 全部已应用；`git diff --check` 通过，源码/文档/示例环境未发现 API Key 格式匹配；没有新增依赖或修改 Milvus schema。

建议本阶段提交信息：`feat(compliance): add project access controls and evidence exports`。当前未执行提交或合并。
