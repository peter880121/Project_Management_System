# 项目信息架构与任务闭环

## 当前引导流

创建项目成功后进入 `/members?onboarding=1`，配置访问授权后直接进入 `/board?onboarding=1`。引导共两步：人员配置、任务安排与执行。保存成员或容量时禁用进入任务管理的链接；容量不是进入下一步的强制条件。旧 `/planning?onboarding=1` 在鉴权后转到任务管理，正常 `/planning` 保留为甘特图地址。

## 编辑职责

| 页面 | 负责内容 |
| --- | --- |
| 项目成员 | 成员访问权、周容量配置和跨项目负载查看 |
| 任务管理 | 负责人、状态、计划开始 / 完成日期、预计工时、前置依赖、交付物和完成签署 |
| 甘特图 | 只读展示阶段、计划区间、依赖线和完成状态；不提供任务编辑 |

任务详情抽屉的“编辑计划安排”复用已有 `PATCH /api/tasks/[taskId]/schedule`，保留 Zod、RBAC、项目冻结、事务审计及 expectedVersion。409 不自动重放修改，重新加载任务后由操作者确认重试；503 保留草稿，保存成功但刷新失败时明确提示已保存并暂停编辑。权限撤销或归档仍通过 Capabilities Context 清空未保存状态。

人员容量复用既有 GET planning 和 PUT capacity 接口。0 小时表示无可用容量，空值表示未配置，不将未知值当作零。跨项目仅展示汇总，不泄漏其他项目标识。

## 看板与阶段

沿用 `所属阶段：xxx` 描述标记及标准医疗交付阶段，支持自定义阶段。看板分列后再按阶段分组，待办默认展开首阶段；移动、创建或采纳任务后展开目标分组并高亮。保留独立列滚动和窄屏横向浏览。

## 只读甘特图

保留真实任务单行结构、阶段前缀与配色，不插入虚构阶段任务行。完整计划使用 plannedStartDate → dueDate；实际完成日期不替换计划终点。未排期或超出图表范围的任务单独列出，提供进入任务管理的链接，不画虚假时间条或跨过缺失任务的依赖连线。

Frappe 固定 readonly_dates / readonly_progress，不注册日期保存回调，不提供任务写入函数。只读详情是独立组件，没有签名、分配、计划编辑、附件上传或 AI 采纳按钮。甘特图初始化或代码加载失败时展示只读任务列表；日 / 周 / 月切换、缩放浏览、刷新和键盘查看详情保留。

阶段元数据通过一次批量请求，与计划快照并发读取；5 秒超时后按未分组展示并提示，不阻塞任务条。AbortController 隔离刷新、切换与卸载后的迟到响应。任务计划变更和 AI 任务创建复用跨标签页刷新事件。

## 数据与验证边界

本次没有新增表、字段或迁移，没有改动业务写 API、审计规则或历史数据，也没有引入新依赖。只有任务安排入口、展示组件和相关测试发生调整。

测试以 `scripts/test-project-ia.mjs` 创建隔离 MySQL 数据库和独立 Next.js 服务，不修改 .env，不向演示库写入夹具。覆盖真实 SQL 审计失败回滚、任务计划 409、保存失败保留草稿、保存过程跳转拦截、角色撤销 / 归档 403、甘特图零写请求、禁拖拽、只读详情、渲染降级以及计划与实际展示。

## 主要文件

- 引导：members/page.tsx、members-workspace.tsx、members-panel.tsx、board/page.tsx、board/task-board.tsx。
- 任务计划：components/tasks/task-plan-editor.tsx、task-detail-drawer.tsx。
- 成员容量：components/planning/member-capacity-panel.tsx。
- 甘特图：planning/page.tsx、planning-panel.tsx、components/planning/planning-gantt.tsx、components/tasks/task-readonly-drawer.tsx。
- 共享读取：components/planning/use-planning-snapshot.ts；导航：components/project-navigation.tsx。
- E2E：task-management-flow、gantt、planning、pm-workflows、project-closure，以及项目模板、计划实际、看板和面包屑回归。

## 本轮验证

- lint、typecheck 通过；81 个单测文件共 514 项通过。
- 真实 MySQL 排期与容量集成测试 8 项通过，包含审计失败整体回滚、并发依赖防循环、版本冲突和迁移结构回滚。
- 相关 E2E 共执行 37 项；首轮 36 项通过，图表降级用例的故障注入范围修正后，甘特图与任务管理相关 7 项复测全部通过。37 个相关用例均已验证，不将未运行的其他 E2E 计入本轮结果。
- 甘特图测试确认 PM / ADMIN / QA / MEMBER 的拖拽不改变数据库、不发送写请求；任务管理测试确认 409、503、成员保存时导航锁定和 403 后清空草稿。
- 隔离测试服务均已退出；本轮没有启动或关闭 4000 端口演示服务。收尾检测到该端口正在运行，保留其编译缓存，只清理本轮测试截图和 trace。演示库和基础账号未修改，验收图可由对应测试重新生成。
