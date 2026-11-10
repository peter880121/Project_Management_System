# 任务生命周期：计划与实际双轨

计划回答“原本承诺何时、花多少工时”，实际回答“最终何时完成、花了多少工时”。签名发生时间另由审计记录，三者不能互相覆盖。

## 数据与兼容

| 字段 | 含义与规则 |
| --- | --- |
| `estimateHours` | 预计工时，必填，0 < 小时 ≤ 10000，最多两位小数 |
| `plannedStartDate` / `dueDate` | 计划开始 / 完成日期，开始不得晚于完成 |
| `actualHours` / `completedAt` | 完成签署时输入；实际工时同精度约束，实际日期不得晚于香港业务日期 |
| `createdAt` | 系统创建时间，不接受客户端覆盖 |
| `completionRoundId` | 本轮完成签署 UUID；重开后置空，再次签署成功时生成全新 UUID，旧审计继续保留 |
| `planningStatus` | MySQL STORED generated column，完整有效计划为 `SCHEDULED`，否则 `UNSCHEDULED` |

复用已有时间和工时字段，新增轮次与派生排期标记。派生列避免漏标，也不需要更新归档任务来回填历史数据。历史空值不伪造计划，统一显示“待排期”。Prisma 通过 `dbgenerated()` 声明只读数据库默认值，真实计算表达式以迁移 SQL 为准。

日期输入统一 `YYYY-MM-DD`，显式编码为 `YYYY-MM-DDT00:00:00.000Z`。这是日历日期编码；显示时取 ISO 日期部分，避免浏览器时区换日。“今天”按 `Asia/Hong_Kong` 计算。真实签署时刻仍为 `AuditLog.createdAt`，不能用补录完成日期替代。逾期统计按业务日边界计算，今天到期不提前计为逾期。

## 创建入口

共享 `taskPlanSchema` / `taskPlanData` 负责阶段、工时、日期顺序和阶段描述规范化；手动 API 另经严格 `createTaskSchema`，拒绝客户端写入创建时间、实际值和轮次等字段。

| 入口 | 计划信息来源 | 缺少日期的处理 |
| --- | --- | --- |
| 手工创建 | 人填阶段、预计工时、预计完成日；可填开始日 | 完成日必填，默认香港今天；缺开始日待排期 |
| WBS 采纳 | 经校验的预计工时；保留建议显式阶段，缺失时继承来源阶段，再兜底“工作分解” | 显式空日期，待排期，不捏造日期 |
| 会议行动项转任务 | PM 确认阶段与工时；可确认建议完成日 | 无建议日期可以为空，待排期 |
| 标准模板 | 14 个已校验标准任务，阶段与预计工时 | 显式空日期，待排期 |
| 开发种子 / 医院演示准备 | 同一计划校验器 | 有完整日期才排期；不会自动重置现有演示库 |

所有业务创建及关联审计在事务内提交。排期接口可补齐或清除计划，数据库即时重新计算排期标记；未排期任务保留在排期池，不绘制虚假任务条。

## 完成与重开

1. 完成弹窗显示任务、计划信息，并要求实际日期、实际工时、密码与枚举签名意图。
2. API 与服务同时校验输入；事务锁定操作者及项目，检查权限、归档冻结和交付物证据，再验证密码。
3. 每次签署成功都生成全新 UUID。新界面传入 `expectedCompletionRoundId` 和 `expectedRowVersion`，版本或轮次变化返回 409，要求刷新后重新签署。
4. 原子更新实际数据，写入 `TASK_SIGNED_AND_COMPLETED`，包含实际日期、实际工时和本轮 UUID。密码不进入审计、日志或响应。
5. DONE 重开至 TODO / IN_PROGRESS 时，清空 **actualHours、completedAt、completionRoundId**，切换严格证据模式，并写入 `TASK_REOPENED`。历史签名只追加保留，不删除。

签名证据查询同时匹配当前轮次、完成日期与实际工时，因此同日重开后旧签名不能复用。仅历史证据模式 1 的空轮次记录保留原有精确时间匹配；新建或重开的严格模式 2 不允许空轮次降级。旧 v1/v2/v3 验收快照保持兼容；新验收使用 v4，加入取消记录与签名版本证据。完整状态机见 [任务取消与重开](task-lifecycle.md)。

签署成功后刷新失败仍明确提示已签署成功，避免重复签署。事务超时沿用统一 P2028 → 503“系统繁忙，请重试”。

## 展示与排期

任务卡展示预计 / 实际工时，抽屉及详情页分开显示计划信息、实际信息、日期及工时偏差。未完成任务不显示旧实际值。任务管理抽屉统一修改计划，保留版本校验、409 刷新与失败暂停编辑机制。甘特图仅读取 `plannedStartDate → dueDate`，不允许拖拽或修改任务；实际完成日期不改变计划条终点。成员容量在成员页维护。结项报告对新快照展示计划与实际，旧快照标明未记录的字段。

## 迁移与验证

`20261023000000_task_plan_actual/migration.sql` 使用列存在性检查，可重放，不 UPDATE 业务历史、不修改审计、不关闭冻结触发器。部署运行 `pnpm exec prisma migrate deploy`；不要用 db push 替代。回滚需停止写入；已有轮次证据时 down 脚本主动拒绝丢弃，采用前向修复。测试旧排期迁移的回滚时，先撤销依赖它的新迁移，再按正序重放。

验证覆盖日历月/年及香港午夜边界、正数精度、跨入口校验、数据库派生列不可伪造、真实 MySQL 审计失败回滚、同日重开及过期轮次拒签、历史快照兼容。浏览器测试验证表单、签名、卡片、待排期池和甘特图计划终点，并在独立合成数据库采集截图，不向演示库灌入测试项目。

截图证据由 `e2e/task-plan-actual.spec.ts` 输出至 `test-results/plan-actual-evidence/`。

## 主要实现文件

| 层次 | 文件 |
| --- | --- |
| 模型 / 迁移 | `prisma/schema.prisma`、`prisma/migrations/20261023000000_task_plan_actual/` |
| 输入 / 日期 / 证据 | `src/modules/tasks/{plan,create-schema,signature,signature-evidence}.ts` |
| 事务入口 | `src/modules/audit/service.ts`、`src/modules/projects/services.ts`、任务 POST / PATCH Routes |
| 证据消费 | `src/modules/projects/acceptance.ts`、`acceptance-check/repository.ts`、`closure-report.ts`、`src/modules/dashboard/repositories.ts` |
| 前端 | `task-plan-fields.tsx`、`electronic-signature-modal.tsx`、`plan-actual-summary.tsx`、任务卡 / 抽屉 / 详情及排期组件 |
| 新增测试 | `src/modules/tasks/plan.test.ts`、`tests/integration/task-plan-actual.test.ts`、`e2e/task-plan-actual.spec.ts` |

验收截图、临时报告和迁移核验产物已在演示前清理；`test-results/` 与 `output/task-plan-actual/` 属于可清理的生成目录，后续运行相关测试可重新采集截图。历史验证结论：演示库迁移前后原有字段哈希一致（29 个任务、147 条审计），无数据重置。原有 v1/v2 验收快照兼容由隔离数据库回归验证；验证时演示库没有已提交验收记录。
