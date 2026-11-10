# 项目与任务基本信息维护

## 入口与边界

看板的“项目设置”进入 `/projects/[projectId]/settings`，维护项目名称、说明和负责人交接。任务详情抽屉的“编辑任务基本信息”维护标题、说明和所属阶段，支持标准阶段及自定义阶段。计划日期、工时和依赖继续使用已有计划编辑入口，甘特图保持纯展示。

项目与任务不开放物理删除。当前没有独立的可丢弃草稿实体，“待排期”也不等于草稿；误建数据通过取消流程注明原因，保留关联资产和审计证据。已完成任务必须先重开才能编辑正文，已取消任务永久只读。

## API 与校验

| 接口 | 用途 | 权限与并发 |
| --- | --- | --- |
| GET `/api/projects/[projectId]` | 项目基本信息及当前负责人 | 项目可见范围内 ADMIN/PM/MEMBER/QA，仅返回显式选择的业务字段 |
| PATCH `/api/projects/[projectId]`，`operation: details` | 修改名称和说明 | 负责人 PM 或 ADMIN；必填 `expectedRowVersion` |
| PATCH `/api/projects/[projectId]`，`operation: transfer` | 交接负责人 | 同上；有效 PM、新负责人 ID、10–1000 字说明、完整项目名称确认 |
| PATCH `/api/tasks/[taskId]`，`operation: details` | 修改标题、说明和阶段 | 有项目访问权的 PM/ADMIN；必填 `expectedRowVersion` |

所有请求使用严格 Zod 对象，不接受通过基本信息接口夹带状态、负责人或签名字段。项目名称、任务标题上限 191 字；项目说明上限 5000 字；任务正文上限 9900 字；阶段 1–50 字且禁止换行和控制字符。任务描述中的阶段标记统一重建为一条 `所属阶段：xxx`，避免重复标记导致分组歧义。

## 事务、交接与冻结

复用项目写锁、统一冻结检查和事务内访问权复核。项目更新增加已有 `Project.rowVersion`；任务更新由现有 Task 触发器增加 `rowVersion`。观察版本不一致返回 409，不覆盖其他会话修改。

交接先锁项目，再按 UUID 顺序锁操作者、原负责人和新负责人，重新校验账号状态与角色，避免和用户禁用、降权发生竞态。原负责人保留有效成员身份，失去负责人专属权限，并撤销其验收例外授权；新负责人获得有效成员身份，不继承原负责人的例外授权。如果新负责人此前已被 ADMIN 单独授予该项目例外权限，则保留这条独立授权。

成员调整、授权撤销、负责人变更及审计在同一事务中提交。新增审计为 `PROJECT_DETAILS_UPDATED`、`PROJECT_OWNER_TRANSFERRED`、`TASK_DETAILS_UPDATED`，记录变更前后值与版本；交接额外记录原因及相关成员/权限审计。任一审计失败，整个操作回滚。

暂停、取消、归档及待验收项目继续使用现有冻结防线，没有新增豁免。HTTP 403 响应也纳入 Capabilities 的统一恢复机制，包括新的项目根路径 PATCH。前端清理未保存输入、恢复只读；保存成功后刷新失败单独提示已经保存，阻止继续使用旧版本重复提交。

任务阶段更新后，看板自动展开目标阶段并高亮任务；看板、成员负荷和甘特图复用现有任务变更事件刷新。任务正文变化也会改变已有验收体检的证据指纹，不能复用旧体检提交验收。

## 数据库与兼容

本次复用现有列、成员表、版本字段与审计 action 字符串，无新增依赖，无需迁移，也未更新演示库数据。保留原有任务 PATCH 分支；现有调用不需要附加新的 `operation` 字段。

## 主要文件

- `src/modules/projects/maintenance-schema.ts`、`maintenance.ts`：项目编辑及交接事务。
- `src/app/api/projects/[projectId]/route.ts`：受项目范围保护的 GET/PATCH。
- `src/app/projects/[projectId]/settings/page.tsx`、`src/components/projects/project-settings.tsx`：设置页。
- `src/modules/tasks/details-schema.ts`、`details.ts`：任务基本信息校验与事务。
- `src/components/tasks/task-details-editor.tsx`、`task-detail-drawer.tsx`：抽屉编辑入口。
- `src/modules/tasks/plan.ts`：复用阶段描述规范化逻辑。
- `src/components/project-navigation.tsx`、`src/components/projects/capabilities-context.tsx`、看板组件：入口、权限恢复与目标分组展开。
- `src/modules/audit/service.ts`：新增审计动作类型。
- `src/modules/projects/maintenance-schema.test.ts`、`tests/integration/maintenance.test.ts`、`e2e/maintenance.spec.ts`：输入、真实数据库和浏览器验证。

## 验证结果

- `pnpm lint`、`pnpm typecheck` 通过；84 个单测文件、540 条单测通过。
- 全量 MySQL 集成回归：239 条通过，2 条依赖外部供应商的既有用例跳过。新增维护专项 16 条，包含真实签署后提交验收/归档再尝试编辑、审计失败回滚、并发交接、权限与版本边界。
- 浏览器新增专项 5 条全部通过，任务生命周期 5 条、任务管理流程 4 条回归通过，合计 14 条不同 E2E。第一次运行的阶段编辑用例在刷新后重复点击已自动打开的详情抽屉，修正测试导航后专项全部通过。
- 浏览器专项未主动采集截图。测试数据只写入隔离数据库，演示库不变，4000 应用服务继续保持关闭。
