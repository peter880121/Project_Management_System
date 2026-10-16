# 事务锁与安全错误响应（2026-10-16）

## 业务约束与选择

任务流转、权限撤销、AI 人工复核、异步任务领取/发布都必须和审计一起提交。事务可以在故障时回滚，但相反的锁顺序仍会造成死锁。这里沿用模块化单体和 MySQL 行锁，不新增分布式锁、队列依赖或数据库表。

现有项目的操作按以下顺序取得锁：

1. Project 行。
2. 会被写入或引用的 User 行，去重后按 UUID 排序。
3. 成员授权和业务记录。解析流程先 Document、后 DocumentParseJob；索引流程先 Document、后分块。队列领取也先取得项目锁，再更新任务租约。
4. 在相同事务中写审计并保留当前授权复核。

集中封装位于 `src/modules/auth/transaction-locks.ts`。UUID 先统一小写再去重排序，保证 MySQL 大小写不敏感列中的同一用户不会因大小写别名改变锁顺序。多用户使用逐行、按序的参数化锁定查询，避免依赖优化器扫描计划来保证锁顺序。系统 worker 也遵守相同规则；风险结果发布预先锁定系统、配置人和项目负责人，避免通知外键检查在事务后段才申请用户锁。配置人的状态/角色使用 locking read，避免 RepeatableRead 旧快照掩盖并发撤权。

全局用户管理只按 UUID 顺序锁用户，不再申请现有项目锁。容量维护若涉及另一个人，先在事务外定位共享项目，再按项目→双方用户锁定，并在事务内重查操作者授权及目标成员范围。创建全新项目先锁创建人，再插入新 UUID 项目；该未提交项目不会被其他事务当作已存在项目操作。

间接资源（任务、建议、文档、通知）先读取不可变 projectId 作为锁定位信息，事务内仍重新读取实体和检查可变状态，不能将定位读取当作授权。现有 API 不支持跨项目移动这些实体；以后增加移动功能时，须按项目 ID 顺序锁定两侧项目并复核归属。

## 失败时的行为

- 不用跳过审计、放宽权限或无锁写入来消除冲突。
- Task 状态更新仍保留状态及 MEMBER assigneeId 条件，AI 复核仍要求 PENDING，worker 仍验证 leaseToken/leaseUntil。
- 同一项目的写入会串行化。这与现有项目授权锁一致，但锁从事务末尾移到了前面；代价是长事务更明显地阻塞同项目其他写入。
- 模型、MinerU、MinIO 和 Milvus 调用保持在短数据库事务外。本轮不新增整段自动重试，以免重复上传或模型请求。
- worker 失败继续使用持久状态、租约到期和已有有限重试恢复；不能从这些测试推断“所有 InnoDB 死锁均已消除”。全局系统用户行仍是 worker 审计的共享锁点，吞吐量需要后续测量。

## HTTP 错误合同

任务创建、分配、流转以及 WBS/风险复核复用 `src/modules/audit/errors.ts`：

| 情况 | 响应 |
| --- | --- |
| 显式 BusinessError | 保留安全业务文案及指定 400/404/409 |
| ProjectAccessError | 保留权限文案及 403（或显式业务状态） |
| Prisma P2034 / P2002 | 409，固定并发冲突提示，不输出错误元数据 |
| 其他异常，包括审计 SQL、连接或未知异常 | 500，固定失败提示；服务端输出固定日志，不返回任意 Error.message |

业务服务使用明确的 BusinessError 表示预期拒绝，而不是由路由匹配字符串判断状态。数据库异常不是业务冲突；审计失败后服务不会返回成功，也不会把 Prisma、SQL 或触发器消息传给客户端。GET 等事务外失败继续由现有 projectScoped 统一兜底。

## 验证

- 并发任务更新/重新分配：暂停 MEMBER 的事务读取，让 PM 请求到达项目锁，然后释放；两者按序成功，原成员随后的写入被拒绝，成功审计不重复。
- worker 领取/计划关闭：暂停领取任务的更新，让关闭请求到达项目锁；领取提交后关闭正常将任务置 SKIPPED，旧 worker 无法发布建议。
- 审计故障：真实 MySQL 触发器抛出带有合成私有错误文本的 SQL 异常；任务创建、分配、状态更新、WBS 采纳/拒绝、风险处理六条路由全部返回相同安全 500，业务与成功审计不落库。
- 单元测试覆盖普通异常、Prisma 异常和未知对象不泄露，以及 409/403/404 的明确映射。
- UUID 边界检查同时发现用户管理原先按请求字符串判定“修改自己”。已增加数据库返回身份的规范化比较，单测和真实 HTTP 测试覆盖大写 UUID 不能修改本人角色/状态。
- 解析、RAG、排期、合规、授权/导出和风险调度七套集成测试第一轮 69 项通过，1 项可选外部联调跳过；新增用例所在两套测试重跑 31 项通过。最终全量结果见审查报告。

## 本轮变更范围

新增 `auth/transaction-locks.ts`、`audit/errors.ts`、`audit/errors.test.ts`。

锁顺序接入：`auth/project-access.ts`、`users/repositories.ts`、`projects/services.ts`、`projects/members.ts`、`audit/service.ts`、`exports/services.ts`、`planning/services.ts` / `repositories.ts`；AI 的 WBS、合规生成/复核、风险生成/计划/通知/worker；documents 的上传、解析、检索、索引服务及 worker/repositories。用户 UUID 身份保护涉及 `users/services.ts`。

安全响应接入：`api/projects/[projectId]/tasks/route.ts`、`api/tasks/[taskId]/route.ts`、`api/ai/wbs/[suggestionId]/route.ts`、`api/ai/risk/[suggestionId]/route.ts`。

回归：`tests/integration/project-access-exports.test.ts`、`tests/integration/risk-scheduler.test.ts`、`tests/integration/users.http.test.ts`、`users/services.test.ts`；文档：本文件、审查报告、已知问题及项目授权/导出说明。

本轮不增加数据库迁移、环境变量、依赖或 Milvus collection 字段；不修改审计表及保留策略。建议提交标题：`fix(transactions): standardize lock order and sanitize business errors`。
