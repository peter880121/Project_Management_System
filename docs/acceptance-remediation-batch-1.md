# 第一批验收整改记录

日期：2026-10-16。分支：`codex/delivery-workflows-review`。本次保留本地变更，不推送远端。

## 逐项结果

| 编号 | 结果 | 说明 |
| --- | --- | --- |
| 1 | 已实现、通过浏览器回归 | 根布局统一显示共享导航，包括首页、项目、当前用户、登出及按角色显示的入口。看板可直接返回首页。 |
| 2 | 已实现、通过浏览器回归及截图检查 | 按钮、操作链接、选择控件和 PDF 文件选择按钮增加边框与交互状态；验证文件和成员选择框的实际边框宽度。 |
| 3 | 待复现、未宣称修复 | 用户描述为 Edge 无痕窗口切换到普通窗口；具体按钮尚未确定。浏览器连接工具未提供可操作的 Edge 窗口。Edge 无头回归中的采纳、保存、文件选择未出现额外页面；这不能证明操作系统窗口焦点问题已经解决。 |
| 4 | 已实现、通过单元和浏览器回归 | 报错定位于 `src/modules/audit/service.ts` 的前置建议校验。保留校验，改为中文原因，展示前置任务状态和定位链接，按依赖顺序排列并禁用不满足条件的采纳按钮。被拒绝或缺失的前置任务给出重新生成或人工核对路径。 |
| 5 | 已实现、通过浏览器回归 | 成功审阅后立即移除建议卡片；使用本地已审阅集合和请求版本避免旧列表重新带回卡片；重新获取前置状态，同时刷新正式任务。模拟旧响应回流的测试通过。用户现场残留的唯一根因尚未证实。 |
| 6 | 已实现、通过浏览器回归及截图检查 | 保存反馈位于对应测试用例表单内，包含名称、成功/失败状态与返回看板入口。保存中禁止重复提交，失败保留输入，成功高亮 5 秒。 |
| 7 | 已实现、通过浏览器回归 | ADMIN/QA 在主导航点击“审计”，进入“审计日志与合规审查”。项目改为按权限加载的名称选择框，无需输入网址或项目 UUID。 |
| 8 | 已实现、通过单元和浏览器回归 | 首页移除“待接入”，写明三个 Agent 的入口、角色和人工确认要求，提供可点击入口。 |

## 文件范围

- 导航与账号互斥：`src/app/layout.tsx`、`src/components/app-header.tsx`、`src/components/app-navigation.tsx`、`src/components/navigation-logout.tsx`、`src/components/account-action-lock.tsx`、`src/app/profile/account-actions.tsx`。
- 移除页面重复导航：`src/app/page.tsx`、`src/app/profile/page.tsx`、`src/app/users/page.tsx`。
- 控件样式：`src/app/globals.css`。
- WBS 审阅：`src/modules/ai/wbs/review-state.ts`、`src/modules/audit/service.ts`、`src/app/api/projects/[projectId]/ai/wbs/route.ts`、`src/app/projects/[projectId]/board/wbs-panel.tsx`。
- 保存反馈：`src/app/projects/[projectId]/traceability/traceability-manager.tsx`。
- 审计入口与项目选择：`src/app/audit/page.tsx`、`src/app/audit/viewer.tsx`。
- 测试：`src/components/app-header.test.ts`、`src/app/page.test.ts`、`src/app/profile/page.test.ts`、`src/modules/ai/wbs/review-state.test.ts`、`src/modules/audit/wbs-acceptance.test.ts`、`e2e/acceptance-ui.spec.ts`、`e2e/compliance.spec.ts`。

## 数据、权限与失败处理

- 无数据库结构变更、无迁移、无新增依赖。
- 现有 API 继续校验角色和项目访问权限；导航显隐不替代授权校验。
- WBS 列表增加 `prerequisites` 字段，依赖查询限制在当前项目。业务写入继续由原事务与审计逻辑负责；不自动采纳依赖、不删除历史建议或审计日志。
- 顶部登出与个人资料页修改密码使用同一互斥锁，防止新增入口造成并发账号操作。
- 身份查询失败时展示重试；列表刷新失败与审阅提交失败分开提示；测试用例保存失败保留输入。

## 验证结果与边界

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：58 个文件、367 项测试通过。
- Windows PowerShell：`$env:ACCEPTANCE_EDGE='1'; pnpm exec playwright test e2e/acceptance-ui.spec.ts --workers=1`：9 项通过，使用本机 Edge 的无头模式。
- `git diff --check`：通过。
- 新浏览器测试读取已有合成数据并模拟业务写请求；不新建测试用户或项目。个人资料测试仅创建自己拥有的临时 Session，并在 finally 中事务清理，核验残留数为 0。没有删除审计记录。
- 截图位于忽略目录：`test-results/acceptance-home.png`、`test-results/acceptance-wbs.png`、`test-results/acceptance-test-case.png`，已检查布局与反馈。
- 本次未跑会生成大量业务测试数据的全量集成/旧 E2E 套件，未执行生产构建。

## 第 3 项后续走查

在 Edge 普通窗口和 InPrivate 窗口同时打开应用，用无痕窗口操作。下一次触发时记录具体按钮、是否刚关闭文件选择框/下载提示/弹窗、两个窗口各自页面，以及 Edge 版本。先按相同操作复现，再定位事件处理或浏览器行为；当前没有依据将某个 `.focus()` 调用认定为根因。

建议本地提交信息：`fix(ui): unify navigation and clarify acceptance workflows`。目前未自动提交或合并。
