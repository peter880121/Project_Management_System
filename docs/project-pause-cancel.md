# 项目暂停、恢复与取消

项目可能因预算、客户决策或资源问题中断。暂停保留恢复能力；取消是终止交付，不等同于完成验收或归档。所有状态说明和原有业务证据保留，不批量完成任务，不清除签名、实际日期或工时。

## 状态与操作权限

| 操作 | 原状态 | 目标状态 | 条件 |
| --- | --- | --- | --- |
| 暂停 | PLANNING / ACTIVE | ON_HOLD | 项目负责人 PM 或 ADMIN；10～1000 字说明 |
| 恢复 | ON_HOLD | 暂停前状态 | 同上；恢复说明必填 |
| 取消 | PLANNING / ACTIVE / ON_HOLD | CANCELLED | 同上；说明必填，完整项目名二次确认 |

只有 `pausedFromStatus` 精确等于 `PLANNING` 才恢复规划状态；`ACTIVE`、缺失、未知值、大小写异常或尾随空白都恢复 `ACTIVE`。MySQL 使用二进制比较，与 TypeScript 的严格比较保持一致。历史暂停不补造原因。

待验收项目须先撤回或驳回当前验收，再暂停或取消。已取消和已归档项目不能恢复。原 `activate` 接口不再接受 ON_HOLD，更不能重新启动 CANCELLED。

## API、并发与审计

复用 `/api/projects/[projectId]/[projectAction]`：新增 `pause`、`resume`、`cancel` 三个 action。

```json
{
  "expectedRowVersion": 1,
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "reason": "客户预算审批暂缓，等待资源确认后恢复执行。"
}
```

取消额外携带 `confirmationName`。Zod strict 拒绝任意状态字段、空白说明和越界输入。服务入口也执行校验，避免内部调用绕过 HTTP 校验。

事务依次锁定 Project、操作者，重新查询项目授权及账号状态，检查版本，创建 `ProjectStatusChange`，更新状态并写审计。失败全部回滚。`(projectId, requestKey)` 唯一约束和项目锁保证重复请求只产生一条记录；相同幂等键不能更换动作、操作者、版本或说明。旧版本返回 409。

三个审计动作：`PROJECT_PAUSED`、`PROJECT_RESUMED`、`PROJECT_CANCELLED`，包含前后状态、版本、说明、操作者、请求标识及 HTTP 元数据。`GET lifecycle` 返回当前说明及最近 50 条状态记录；全部历史保留在数据库中。

## 复用冻结防线

没有新增第二套业务冻结拦截器：

1. `freeze.ts` 的 `FROZEN_PROJECT_STATUSES` 同时供 HTTP、事务、Capabilities 和 Worker 候选查询使用。
2. `assertProjectWritable` 与 `lockProjectForWrite` 复用同一状态判断；Worker 模式也不能绕过暂停和取消。
3. 现有 **60 个 freeze 触发器保留**。业务表继续调用同一个 `medpm_assert_project_write`，按 Project 主键锁读并阻断 ON_HOLD / CANCELLED。
4. Project 自身原有 UPDATE / DELETE 触发器扩展状态规则；使用 `OLD.status`，避免锁读正在更新的同表触发 MySQL 1442。
5. 恢复和暂停后取消是受约束的生命周期操作：数据库检查新事件、前后状态、原版本、说明、恢复目标及其他项目字段未被夹带修改。不存在通用解冻开关。

ON_HOLD / CANCELLED 在 HTTP 与流内错误均使用 `PROJECT_FROZEN`，HTTP 状态为 403；返回明确的暂停或取消提示。原归档和待验收错误契约保持兼容。

新表的三个 `lifecycle_evidence_*` 触发器只负责状态证据的插入校验及不可更新、不可删除，不重复添加业务冻结触发器。

## 界面和后台任务

- 各项目页共享状态操作栏；说明弹窗、取消项目名确认、状态历史复用一个组件。
- 暂停显示橙色冻结条，取消显示红色永久只读条，展示原因、操作人和时间。
- 任务状态按钮、完成按钮、任务计划表单、新建任务、成员及资产编辑受 Capabilities 控制。卡片禁止原生拖动；甘特图沿用纯展示模式，无拖拽保存入口。
- 403 立即清除未保存状态，重读权限。暂停成功后先关闭编辑能力，再刷新，刷新失败明确提示“操作已成功，但数据刷新失败，请手动刷新”。
- 生命周期刷新使用请求序号和 `rowVersion`，旧 ACTIVE 响应不能覆盖新暂停状态。
- 暂停、取消不计入 PMO 当前执行负荷及周容量占用；任务计划、历史工时不变。恢复不会自动顺延日期，应由 PM 复核资源与延期。
- Worker 不再领取冻结项目；运行中的任务仍受提交事务冻结校验。暂停期间保留队列和租约证据，恢复后按原重试机制继续；取消后永久不领取。已发往外部供应商的调用不能保证即时撤销，但不能绕过事务写入项目数据。

## 模型、迁移与回滚

`ProjectStatus` 增加 CANCELLED；Project 新增 `pausedFromStatus`、`currentStatusChangeId`；新建 `ProjectStatusChange`，含操作者外键、幂等唯一键及项目时间索引。新字段对历史行默认 NULL，不改写历史状态或审计。

迁移：`prisma/migrations/20261024000000_project_pause_cancel/migration.sql`。DDL 支持重复执行。MySQL DDL 隐式提交，部署应停写；本次在应用服务关闭时部署。

`rollback.sql` 只允许尚未产生生命周期记录、没有取消项目时回退空结构。存在任何状态记录时拒绝回退，不能以删除审计、取消记录或修改历史状态换取降级。

2026-10-20 已应用到当前本地开发／演示库，迁移前后均为 **3 个项目、43 个任务、175 条审计**，状态变更表为空。没有加入测试夹具。4000 服务保持关闭；测试服务器均由隔离脚本启动并清理。

## 变更文件

- 模型：`prisma/schema.prisma`；上述 migration / rollback。
- 生命周期：`src/modules/projects/lifecycle.ts`、`acceptance.ts`、`capabilities.ts`、`status-display.ts`、`freeze-manifest.ts`。
- 统一冻结：`src/modules/projects/freeze.ts`、`write-scope.ts`、`src/modules/auth/transaction-locks.ts`。
- API：`src/app/api/projects/[projectId]/[projectAction]/route.ts`、`lifecycle/route.ts`。
- 界面：`src/components/projects/lifecycle-controls.tsx`、`capabilities-context.tsx`、`src/app/projects/[projectId]/layout.tsx`、`board/task-board.tsx`、`src/components/tasks/task-card.tsx`。
- SSE：`src/modules/ai/streaming/client.ts`、`response.ts`、`src/components/use-ai-generation.ts`、`src/components/assets/meeting-ai-panel.tsx`、`src/components/projects/acceptance-check-controls.tsx`。
- 审计与调度：`src/modules/audit/service.ts`、`src/modules/assets/source-worker.ts`、`src/modules/documents/parse-repositories.ts`、`rag-repositories.ts`、`src/modules/ai/risk/scheduler-repositories.ts`。
- 负荷：`src/modules/dashboard/scope.ts`、`src/modules/planning/repositories.ts`。
- 测试：`src/modules/projects/lifecycle.test.ts`、`tests/integration/project-lifecycle.test.ts`、`e2e/project-lifecycle.spec.ts`；修正 `e2e/project-closure.spec.ts` 对 QA 执行权限与项目冻结的区分。

## 验证与截图

- `pnpm lint`、`pnpm typecheck`。
- 全量单测：82 个文件、531 项。
- 相关真实 MySQL 集成：51 项，分组执行，包括生命周期 20、归档 14、排期 8、Dashboard 9。覆盖迁移重复执行、安全回滚、审计失败回滚、权限隔离、并发、旧入口及直接 SQL 写入阻断。
- 相关 E2E：21 个独立用例通过（20 项完整回归及包含新增延迟响应场景的 5 项生命周期复测；重叠用例不重复计数）。覆盖看板布局、只读甘特图、原归档流程、任务计划冲突与暂停／取消。未宣称执行全仓库 E2E。
- 测试仅在 `medpm_test_ia_*` 等隔离合成数据库中执行；不调用真实模型供应商。测试数据库保留作证据，没有清除不可改写日志。

一次回归在旧 `task_plan_actual` 迁移遇到本地 MySQL 1025 临时重命名错误；新隔离库复测通过，没有修改旧迁移或重试真实业务写入。冷启动 Next.js 的首个任务 API 编译曾超过默认 5 秒断言，页面准备断言调整为等待实际按钮最多 15 秒，未添加固定 sleep。

全库 Prisma diff 仍报告与全新迁移库一致的历史差异：DocumentParseJob 的 documentId 外键、Task 的 projectId 外键／额外索引、生成列 planningStatus 的可空性。本次新增模型、字段及枚举已对齐；未执行可能删除既有索引或外键的自动 schema 同步。这些历史差异应单独核对迁移，不应直接执行 diff 输出。

截图（均为合成数据）：

- [暂停说明弹窗](../output/project-lifecycle-evidence/pause-reason.png)
- [暂停看板与禁用按钮](../output/project-lifecycle-evidence/paused-board.png)
- [暂停后的只读甘特图](../output/project-lifecycle-evidence/paused-gantt.png)
- [取消说明与项目名确认](../output/project-lifecycle-evidence/cancel-confirmation.png)
- [取消后的只读看板及状态记录](../output/project-lifecycle-evidence/cancelled-board.png)
- [编辑中收到冻结 403](../output/project-lifecycle-evidence/stale-edit-frozen.png)

建议提交信息：`feat(projects): add audited pause resume and irreversible cancellation`。未自动提交、合并或新增依赖。
