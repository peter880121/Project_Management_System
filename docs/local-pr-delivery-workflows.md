# 本地 PR 草稿：医疗软件交付闭环、项目隔离与审计证据

需求变更后，团队需要知道哪些任务/测试尚未复核新版本；PM 需要基于文档证据确认 WBS，并查看排期与资源风险；QA 需要在授权范围内导出可追溯证据。本批变更将这些流程接入项目权限、人工确认和事务审计，提供文档上传/解析/RAG、追溯复核、排期容量、风险调度通知及合规证据导出。

当项目成员被撤权或审计写入失败时，相关业务提交与文件交付会被阻断。WBS、风险、合规摘要保持 PENDING，PM/QA 明确复核后才改变相应业务或建议状态。

## 本地状态与提交边界

- 分支：`codex/delivery-workflows-review`。
- 比较基线：`21dc16a`（本轮整理前 HEAD）。这是本地审阅基线，不是假定的远端 main。
- 用户明确要求先放本地：未配置 remote、未推送、未创建远端 PR，也未合并 main。

| 提交 | 内容 | 独立性 |
| --- | --- | --- |
| `911e1fd` `fix(auth): serialize login attempts and session writes` | 登录账号锁、READ COMMITTED、仅重试已回滚的 P2034；故障不签发会话 | 基线加本提交的独立源码快照：lint/typecheck/224 项单测通过 |
| `d24f7a5` `fix(users): normalize identity checks and user lock order` | UUID 规范化排序、用户身份别名不能绕过本人变更保护 | 前一快照加本提交：lint/typecheck/225 项单测通过 |
| `f714964` `feat(platform): add audited delivery workflows and project isolation` | 交付功能、共享 Prisma/审计/权限封装、事务安全、API、页面、worker、测试及配置 | 保留完整依赖与纵向流程，190 个文件，6575 行新增/357 行删除 |
| 本文件所属文档提交 `docs: prepare local delivery workflow review` | 运行说明、已知问题、审查与验证证据、本 PR 正文 | 不改变运行行为 |

两个独立快照从原 HEAD 导出，仅覆盖对应提交文件，没有复制真实 `.env`；复用本机已安装的 node_modules 与生成的 Prisma client，未做全新依赖安装验收。

剩余交付功能共享数据模型、项目授权、审计服务及页面入口。按目录拆成多个中间提交会引入缺失模块或不完整权限路径，因此保留为一个完整功能提交；按下列模块顺序审阅，而不是将不可独立运行的文件组当作独立交付。

## 模块审阅顺序

| 顺序 | 业务模块 | 优先阅读 |
| --- | --- | --- |
| 1 | 项目授权、事务锁和安全响应 | `auth/project-access.ts`、`auth/project-scope-http.ts`、`auth/transaction-locks.ts`、`audit/service.ts`、`audit/errors.ts` |
| 2 | 需求—任务—测试与合规复核 | `projects/services.ts`、`ai/compliance-audit/`、`api/projects/[projectId]/traceability/`、`app/audit/` |
| 3 | PDF 上传、解析与恢复 | `documents/services.ts`、`parse-service.ts`、`parse-worker.ts`、`mineru.ts`、`storage.ts` |
| 4 | 文档 RAG 与 WBS 证据 | `documents/rag-*`、`vector/documents.ts`、`ai/wbs/`、`app/projects/[projectId]/documents/` |
| 5 | 排期、依赖、跨项目容量 | `planning/`、`api/tasks/[taskId]/schedule/`、`app/projects/[projectId]/planning/` |
| 6 | 风险调度与个人通知 | `ai/risk/worker.ts`、`scheduler-*`、`notifications.ts`、`app/notifications/` |
| 7 | 成员管理与证据导出 | `projects/members.ts`、`exports/`、`app/projects/[projectId]/members/`、`exports/` |
| 8 | 故障与越权回归 | `tests/integration/`、`e2e/`、`src/modules/**/*.test.ts` |

上述简写的模块路径位于 `src/modules/`；API 与页面路径位于 `src/`。完整差异可运行：

```powershell
git diff --stat 21dc16a..HEAD
git log --reverse --oneline 21dc16a..HEAD
git diff 21dc16a..HEAD -- src/modules/auth src/modules/audit
```

## 数据模型与迁移

新增七组 migration；各目录均含 `migration.sql` 和人工回滚参考 `down.sql`。使用 UUID char(36)、DATETIME(3)、MySQL JSON、utf8mb4/InnoDB。MySQL 与向量通过业务 ID 关联，向量/对象存储不是同一数据库事务。

| 部署顺序 | migration | 主要范围 |
| --- | --- | --- |
| 1 | `20261015000000_compliance_review` | 需求版本复核字段、问题复核记录 |
| 2 | `20261015010000_document_upload` | 文档存储状态、哈希、上传幂等与恢复 |
| 3 | `20261015020000_document_parse_jobs` | 持久解析任务、版本、租约与结果证据 |
| 4 | `20261015030000_document_chunks` | 文档分块、向量状态与重试 |
| 5 | `20261015040000_scheduling_capacity` | 计划起始日、排期版本、成员周容量 |
| 6 | `20261015050000_risk_scheduler_notifications` | 风险计划、扫描任务、个人通知 |
| 7 | `20261015060000_project_members_compliance_exports` | 项目成员授权与合规导出元数据 |

部署前备份数据库和 MinIO，按环境配置密钥；迁移使用 `pnpm db:deploy`（Compose migrate 服务执行相同命令），不要在生产使用 migrate reset。历史授权只回填项目负责人和任务负责人，其他 PM/QA 需要显式添加，不能假定历史用户继续拥有全部项目访问权。

回滚须先停止应用与 worker、备份新增授权/复核/排期/导出等业务数据，按迁移逆序评估执行 down.sql，再恢复兼容应用。Prisma 不会自动执行 down.sql；结构回滚测试保留审计，不等于新增业务数据可无损恢复。MinIO 对象和 Milvus 向量需单独处理。回退项目授权迁移会失去项目隔离，应优先前向修复。

## 配置与依赖

- 新增 `fflate@0.8.2`，用于读取 MinerU ZIP 结果；限制压缩包大小、条目数和选定文件展开大小，不将压缩内容解压至任意磁盘路径。
- `.env.example` 增加 MinerU、OpenAI 兼容端点及模型配置。示例邀请码为空，存储/向量默认 localhost；实际密钥只放本地 `.env` 或部署密钥管理。
- `pnpm documents:worker` 与 `pnpm risks:worker` 为独立进程；Compose 的 parse/risk profile 提供对应服务。
- 本轮没有修改 Milvus collection 字段，documents 继续使用 1536 维/COSINE，projectId 过滤位于 vector 封装。

## 验证证据

| 检查 | 结果及范围 |
| --- | --- |
| 本次提交整理 | lint、typecheck、55 个单元测试文件/357 项用例再次通过；暂存差异 whitespace 检查通过 |
| 登录/用户拆分 | 两个中间源码快照分别通过 224/225 项单测及 lint/typecheck；不依赖未提交功能源码 |
| 已完成的集成验收 | 全量 108 项通过、2 项可选外部联调跳过；最终 UUID 边界修复后用户管理 9 项 HTTP 复测通过 |
| 已完成的浏览器验收 | 6 项通过：合规、文档上传/QA 下载、排期容量、成员授权/CSV/JSON/撤权、任务流转、追溯维护 |
| 生产构建 | 最终业务代码的 pnpm build 通过；本次整理未改运行源码，只清理 `.env.example` 的本机值 |
| Compose/迁移 | compose config 校验通过；本地 12 组迁移已应用；新增七组的结构回滚在隔离 MySQL 测试中验证 |
| 故障注入 | 审计 SQL 失败时任务创建、分配、状态、WBS 采纳/拒绝、风险处理全部回滚，返回固定 500；权限撤销和损坏对象不交付导出文件 |
| 并发 | 门闩控制任务更新/重新分配、worker 领取/计划关闭；保留条件写入、租约 fencing 与成功审计去重 |

集成、浏览器和构建证据来自前一收口阶段，同一最终业务代码；本次只为验证提交边界新增临时源码快照检查并重跑标准三项检查。没有将历史证据写成新一轮外部验收。

## 限制与后续工作

- WBS 成功采纳后的完整业务撤回/补偿流程仍未实现；事务失败回滚不等于人工撤回。
- 锁顺序修复降低已识别锁环风险，不能证明所有 InnoDB 死锁已消除。共享系统用户锁与同项目串行写入的吞吐需测量；历史任务列表间歇 500 未确定根因。
- 本批未重新完成真实 MinerU 云解析、真实模型质量/RAG 浏览器全链路、全新依赖安装或生产容器部署验收。
- 只使用合成数据；尚无完整 PHI 自动识别、电子签名、不可变对象存储、正式法规验证与生产保留策略。

细节与追踪见 [审查报告](code-review-2026-10-16.md)、[事务设计](transaction-locking.md)、[已知问题](known-issues.md)。
