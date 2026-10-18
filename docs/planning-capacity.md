# 排期与人员容量

本阶段为风险 Agent 提供可维护的数据来源，对应 `docx/prompts/07-风险预警Agent.md`。PM 手工确定日期、工时、依赖和容量；系统发现风险并生成 PENDING 建议，不自动改排期、分配或状态。

## 甘特图交互（2026-10-17）

排期页默认显示甘特图，可切换日、周、月或原有表格。图表使用固定版本 `frappe-gantt@1.2.2`，通过 `next/dynamic` 的 `ssr: false` 隔离浏览器依赖；样式限定在 `.medpm-gantt` 内。点击任务条复用任务详情抽屉，抽屉操作后刷新排期。

PM 拖动或缩放时，保存鼠标按下时的版本、预计工时及依赖快照，调用原有排期 PATCH；关闭 `move_dependencies`，不会连带修改其他任务。409 显示“排期版本已更新，请刷新后重试”并读取最新数据，同时用图表 `refresh()` 恢复实际 SVG 时间条。刷新失败则暂停编辑。其他保存错误也回退时间条，不自动重试写入。

已完成任务和非 PM 角色只读。触屏支持横向浏览，精确改期使用表格。缺少日期或跨度超过十年的任务单独列出，不推断日期；涉及未绘制任务的依赖需在表格核对。新视图不增加数据库迁移，不改变接口、服务端权限或原有事务审计。

## 业务口径

- 排期按 UTC 日历日：开始为 00:00:00.000，截止为当日 23:59:59.999；空值表示未知。开始不得晚于截止，预计工时为 0.01–10000 小时，精度两位小数。
- 周容量按 UTC 周一至周日维护，是同一成员跨所有项目共享的预算，范围 0–168 小时。0 表示本周无可用容量，null 表示未配置；不自动假设每人每周 40 小时。
- 未完成任务的全部预计工时在开始日至截止日之间按日历天均摊，按重叠天数计入选定周。不扣减 actualHours，因为它是完成时记录的总工时，不是剩余工时。
- 缺日期/工时、已逾期但未重新排期的未完成任务列为待确认，不视作零负载。不完整时仅可证明已知工时超过容量，不能据此证明负载正常。
- 本阶段没有节假日、工作日历、技能匹配、每日容量或自动排程。均摊是可解释的粗估，非精确资源计划。

## 数据、权限和接口

迁移 `20261015040000_scheduling_capacity` 新增 Task.plannedStartDate、scheduleVersion 和 MemberWeeklyCapacity（UUID、DATETIME(3)、DECIMAL、utf8mb4/InnoDB，userId/weekStart 唯一）。复用现有 dueDate、estimateHours 和 TaskDependency。所有维护与审计同事务；历史任务开始日期保持 null，不推断排期。

从看板进入 `/projects/<projectId>/planning`。所有已登录角色可读，只有有效 PM 可写；ADMIN 在该业务页只读。当前仍是全局 RBAC，尚无项目成员级授权，容量数据也在该全局范围可见。

| API | 行为 |
| --- | --- |
| GET /api/projects/:projectId/planning?weekStart=YYYY-MM-DD | 项目排期及选定周跨项目负载；weekStart 必须周一，默认当前 UTC 周 |
| PATCH /api/tasks/:taskId/schedule | 完整提交 plannedStartDate、dueDate、estimateHours、dependencyIds、expectedVersion |
| PUT /api/users/:id/capacity | 提交 weekStart、hours、expectedVersion；未设置过版本为 0，null 清除容量配置但保留版本 |

任务 scheduleVersion 与容量 version 校验，旧版本返回 409。写入前重新锁定并校验 PM 账号；依赖图按项目串行维护，拒绝自依赖、重复依赖、跨项目依赖和间接循环。已完成任务排期不可直接修改，须先明确重新打开，避免改写历史延期依据。容量只能为有效非系统账号维护。

审计动作 TASK_SCHEDULE_UPDATED 和 MEMBER_CAPACITY_UPDATED 保存 before/after、操作者、IP/userAgent、版本和范围。容量是全局操作，审计 projectId 为 null，范围标记 ALL_PROJECTS。没有新增导出功能。

## 风险扫描

扫描仍由 PM 手动触发。规则版本 2 保留临近截止未开始、任务数阈值、前置未完成、历史延期率，并增加：所有未完成状态的逾期、依赖日期顺序冲突、当前 UTC 周跨项目工时超容量、容量/排期数据缺失。

扫描在一致数据库快照中读取数据；容量依据保存 weekStart、计划/容量工时、跨项目任务/项目 ID 和缺失数据 ID。每类引用最多保存 100 个，同时保存完整数量与 referencesTruncated。工时统计使用完整受限快照，不以截断引用计算负载。已知工时超过容量时仍报警，即使还有未纳入统计的任务。

相同任务、相同依据的待确认风险不重复创建；依据变化后允许产生新建议。旧建议保留原证据，排期修改不会自动关闭或改写旧风险，PM 整改后重新扫描并明确“已处理/忽略”。待处理列表沿用最多 100 条展示，处置后刷新可继续查看。

数据上限：项目 5000 个任务、1000 个成员、相关成员跨项目 20000 个未完成任务。超限返回明确错误，不把部分结果展示为完整统计。服务或审计失败时事务回滚，用户可重试，已有任务状态保持原样。

## 迁移与验证

运行 `pnpm db:generate`、`pnpm db:deploy` 后重启应用。本地迁移已应用。回滚须先停应用并备份排期/容量数据，再执行 down.sql；脚本删除新增字段/容量表，保留 Task 行、dueDate/estimateHours、依赖及审计。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/planning.test.ts
# 应用启动后配置 E2E_BASE_URL
pnpm exec playwright test e2e/planning.spec.ts --workers=1
```

单元测试覆盖日历周分摊、跨项目负载、未知/零容量、逾期/不完整数据、依赖环和 API 权限/输入。隔离本地 MySQL 测试覆盖不同 PM 并发构造依赖环、旧版本冲突、已完成任务保护、审计失败回滚、风险快照/去重与迁移回滚。浏览器已验收 PM 排期维护 → 配置容量 → 两项目合计 60 小时超过容量 40 小时 → 风险证据展示 → QA 页面/API 只读。全部使用合成数据，本阶段不调用 LLM 或外部服务。

## 修改文件与后续

- prisma/schema.prisma 与 migrations/20261015040000_scheduling_capacity/{migration.sql,down.sql}
- src/modules/planning/{schemas,rules,repositories,services,http}.ts 及规则/API 测试
- src/app/api/projects/[projectId]/planning/route.ts、tasks/[taskId]/schedule/route.ts、users/[id]/capacity/route.ts
- src/app/projects/[projectId]/planning/{page,planning-panel}.tsx；board/page.tsx、risk-panel.tsx
- src/modules/ai/risk/{rules,service}.ts、rules.test.ts；src/modules/audit/service.ts
- tests/integration/planning.test.ts；e2e/planning.spec.ts；README.md；本文

未新增依赖或环境变量，不改变 Milvus collection。检查未发现本阶段引入的密钥、权限绕过或直接写入正式业务表的 AI 输出。均摊口径、全局权限和手动触发是当前限制。下一阶段可推进风险异步调度与通知，以及合规导出、项目成员权限隔离。

建议提交信息：`feat(planning): add audited scheduling and weekly resource capacity`。本阶段未提交或合并到 main。
