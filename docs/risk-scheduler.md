# 自动风险扫描与站内通知

本阶段对应 `docx/prompts/07-风险预警Agent.md` 的异步执行方向。沿用已验收的确定性风险规则，复用模块化单体和 MySQL 持久化队列模式，不新增 Redis 依赖，不调用 LLM，不向邮件、短信或外部聊天工具发送消息。

## 使用方式

1. 应用迁移：`pnpm db:generate`、`pnpm db:deploy`；确保已有 seed 中的 system user（系统审计身份）。
2. 分别启动应用 `pnpm dev` 和风险 worker `pnpm risks:worker`。
3. PM 在项目看板“自动风险扫描”中显式启用，选择 15/30/60/360/1440 分钟间隔并保存。默认关闭，启用后首次可立即排队。
4. PM 在首页/项目页看到未读提醒，或打开 `/notifications` 查看自己的通知。通知详情保留原风险依据；标为已读不代表风险已处理。

`pnpm risks:worker --once` 执行一轮调度和处理，不是启动常驻调度器。Docker Compose 可运行 `docker compose --profile risk up -d risk-worker`，仅依赖 MySQL 和迁移服务，镜像需要保留当前 TypeScript 运行工具链。新数据库仍需准备 system user；只应用迁移不等于完成 seed。

## 权限与业务行为

只有有效 PM 可配置、查看计划及重试失败扫描。计划记录最后配置者和版本；项目负责人及配置 PM 中仍有效的 PM 接收新风险通知，去重后最多两人。手动扫描也通知发起 PM 与负责人。不广播所有 PM，不通知 MEMBER/QA/ADMIN。

站内通知列表、详情和已读操作都按当前会话 userId 过滤，不能通过参数读取别人的通知。标记已读会记录审计，重复操作幂等；底层风险保持 PENDING，仍需 PM 明确“已处理/忽略”。生成、通知插入和任务完成在同一事务提交，审计失败全部回滚。

项目 ON_HOLD/COMPLETED 时任务记为 SKIPPED；恢复项目后下一周期继续。配置 PM 被禁用、降级或变为系统账号时跳过扫描并自动关闭计划，记录系统审计；需其他有效 PM 明确重新启用。计划更新或关闭会取消尚未提交的旧版本任务；已经完成提交的扫描不会被撤销。

目前项目授权仍沿用全局 PM 角色，计划维护未引入项目成员级限制；通知个人隔离已独立实现。未来项目权限模块应同步收紧计划配置与风险详情范围。

## 调度、重试与一致性

迁移 `20261015050000_risk_scheduler_notifications` 新增 RiskScanSchedule、RiskScanJob、RiskNotification 三张表，使用 UUID、DATETIME(3)、utf8mb4/InnoDB。计划以 projectId 唯一，任务以 scheduleId/dueAt 唯一，通知以 userId/suggestionId 唯一。历史项目不会自动启用扫描。

Worker 每 5 秒选取一个到期计划、处理一个可执行任务。项目锁串行调度，项目最多一个待执行/执行中任务；已有任务时推进下次时间，避免停机后追赶大量过期周期。已处理时间槽不会重复插入或永久阻塞队列。恢复后按当前时间继续，不补跑每一个错过的周期。

任务领取使用 60 秒租约和随机 token；业务事务上限 20 秒。过期 worker 不能提交状态，重启后租约到期可恢复。扫描、风险、通知、完成状态与审计原子提交，避免提交后又被当作未完成任务重跑。单次任务最多三次尝试，失败延后约 20/40 秒再试；数据超限等明确业务错误直接 FAILED。租约连续丢失三次也会最终失败。FAILED 可由 PM 显式重试，下个周期也可产生新的扫描任务。

错误只保存安全代码，不记录数据库原始错误或凭据。数据库/审计整体不可用时保持事务回滚，队列和过期租约在服务恢复后继续处理；前端仍可使用手动扫描，自动功能需要 worker 运行。当前没有 worker 心跳告警、分布式通知推送或严格实时调度承诺。

新风险继续按完整判断依据与来源去重；相同待确认风险不重复通知。风险被处理或忽略后，若同类问题仍存在，未来扫描可能再次提醒；没有永久静默或免打扰策略。原建议与通知不随新排期改写，不自动关闭历史风险。

## 页面与 API

| 接口 | 功能 |
| --- | --- |
| GET/PUT /api/projects/:projectId/risk-schedule | 计划与最近 10 次任务；PUT 包含 enabled、intervalMinutes、expectedVersion |
| POST /api/risk-jobs/:id/retry | 重试 FAILED；要求当前计划启用、版本匹配且没有活动扫描 |
| GET /api/notifications?page=1 | 个人通知，每页 20 条，未读数量与 hasMore；身份来自会话 |
| POST /api/notifications/:id/read | 仅收件人可标记已读，其他人返回 404 |
| /notifications/:id | 个人风险详情，保留原判断依据及关联任务入口 |

PM 导航和项目页展示未读数量，初次加载、窗口重新聚焦及可见页面每 60 秒刷新；这是轮询提醒，不是实时推送。查询故障时显示“暂不可用”，通知页可手动刷新。通知仅在站内数据库保存。

审计动作：RISK_SCHEDULE_UPDATED、RISK_JOB_QUEUED/STARTED/COMPLETED/FAILED/SKIPPED/RETRIED、RISK_NOTIFICATIONS_CREATED、RISK_NOTIFICATION_READ，以及原有 AI_RISK_SUGGESTIONS_GENERATED/处置审计。自动事件使用 system actor，计划和完成记录保留 configuredById，batchId 关联风险建议。

## 验证与回滚

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/risk-scheduler.test.ts tests/integration/planning.test.ts
# 启动应用及 risks:worker，配置 E2E_BASE_URL 后运行
pnpm exec playwright test e2e/risk-scheduler.spec.ts --workers=1
```

隔离本地 MySQL 测试覆盖并发调度、时间槽去重、租约恢复、关闭计划、授权撤销、暂停项目、三次失败和显式重试、风险/通知/审计原子性、个人通知隔离与幂等已读、迁移回滚。浏览器使用真实应用、独立 worker、MySQL 和合成任务完成“启用计划 → 自动扫描 → 未读提醒 → 来源详情 → 已读 → 另一 PM 访问被拒绝”，验证任务状态和风险待确认状态不变。本阶段不调用外部 AI 或存储服务。

本地迁移已应用。回滚须停应用与 worker、备份计划/任务/已读数据，再执行迁移目录 down.sql；仅删除本阶段三张表，保留 AiSuggestion 风险、业务任务和审计记录。测试库运行结束后删除；浏览器测试保留合成业务和审计，清理自身 Session 并关闭测试计划。

## 修改文件

- prisma/schema.prisma；migrations/20261015050000_risk_scheduler_notifications/{migration.sql,down.sql}
- src/modules/ai/risk/{scheduler-repositories,scheduler-service,notifications,worker}.ts；service.ts；scheduler-routes.test.ts
- src/modules/planning/repositories.ts；src/modules/audit/service.ts
- src/app/api/projects/[projectId]/risk-schedule/route.ts；risk-jobs/[id]/retry/route.ts；notifications/route.ts；notifications/[id]/read/route.ts
- src/app/projects/[projectId]/board/{risk-panel,risk-schedule-panel}.tsx；src/app/projects/page.tsx
- src/app/notifications/{page,notification-panel}.tsx；notifications/[id]/page.tsx；src/components/{app-navigation,risk-notification-link}.tsx
- scripts/risk-worker.mjs；package.json；docker-compose.yml；tests/integration/risk-scheduler.test.ts；e2e/risk-scheduler.spec.ts；README.md；本文

没有新增依赖、环境变量或向量集合变更。下一阶段按计划补合规导出与项目权限隔离。建议提交信息：`feat(risk): add durable scheduled scans and private notifications`；未提交或合并到 main。
