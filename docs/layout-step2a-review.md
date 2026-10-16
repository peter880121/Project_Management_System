# 步骤 2 · 批次 A 验收记录

状态：已实现并验证，等待批次 A Review；未开始批次 B。

## 范围与实现

- 顶部栏固定 56px，桌面端从侧边栏右侧 240px 开始；内容预留顶部空间。窄屏集成侧边栏开关，长面包屑在自身区域内横向滚动，用户菜单保持可见。
- RootLayout 放置 BreadcrumbProvider；服务端页面生成 label/href 与所属 pathname，PageBreadcrumbs 只负责注册，顶部栏只展示。
- Provider 监听 usePathname，在 useEffect 中 reset 旧路径数据；显示前再次匹配 pathname，切换时不会显示其他路径的项目名。注册实例使用 owner 标识，旧页面卸载不能清除新注册；reset 保留已经注册的新路径。
- 本批只接入项目列表、项目看板和任务详情。首页无面包屑；其余页面的面包屑留待批次 B。
- 项目名和任务标题复用已有服务端查询，本批没有新增数据库查询。
- 项目名始终为不可点文本，代码注释明确不存在 /projects/[id] 页面。
- 任务面包屑 helper 在缺少项目关联时返回“项目 / 任务标题”，“项目”链接 /projects，不生成项目详情或看板链接。注释及单元测试覆盖此降级；现有任务权限校验及页面内容不变。
- 头像菜单显示邮箱与角色，提供个人资料及共享登出按钮。menu/menuitem、Enter/Space、上下箭头、Home/End、Escape、点击外部关闭与焦点恢复均已接入；Tab/Shift+Tab 关闭并移出菜单，不强制拉回焦点。
- 移动端抽屉关闭后，先解除背景 inert，再恢复顶部栏菜单按钮焦点，避免背景锁定导致恢复失败。焦点恢复仅在当前文档仍有焦点时执行。
- 不删返回按钮，不改 API、数据库 schema、业务操作或测试基础设施，无新增依赖。

## ProjectWorkspace 全局搜索结果

`rg -n 'ProjectWorkspace|project-workspace' .` 发现两个实际页面引用：

- `src/app/projects/[projectId]/wbs/page.tsx`
- `src/app/projects/[projectId]/risks/page.tsx`

因此保留 `src/components/project-workspace.tsx`，本批不修改该组件或上述两页。

## 文件清单（14 个）

修改 7 个：

1. `src/app/layout.tsx`
2. `src/components/layout/app-shell.tsx`
3. `src/app/projects/page.tsx`
4. `src/app/projects/[projectId]/board/page.tsx`
5. `src/app/tasks/[taskId]/page.tsx`
6. `src/components/navigation-logout.tsx`：增加可选 menuItem 属性。
7. `src/app/profile/logout-button.tsx`：增加可选 role/tabIndex，复用原登出逻辑。

新增 7 个：

1. `src/components/layout/app-topbar.tsx`
2. `src/components/layout/breadcrumbs.ts`
3. `src/components/layout/breadcrumb-context.tsx`
4. `src/components/layout/page-breadcrumbs.tsx`
5. `src/components/layout/breadcrumbs.test.ts`
6. `e2e/layout-topbar.spec.ts`
7. `docs/layout-step2a-review.md`

工作区原有其他改动保留，不计入本批清单。

## 验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过，包含新增 E2E 文件。
- `pnpm test`：62 个文件、385 项测试通过。
- E2E：18 项全部通过，耗时 48.5 秒。包括现有 acceptance-ui 9 项、pm-workflows 4 项，以及新增 layout-topbar 5 项。
- 全量 E2E 尚未执行，按阶段安排留至步骤 3；这里的结果仅代表上述三组测试。
- `git diff --check`：通过，已有部分文件显示换行符转换提示。

运行方式：

```powershell
$env:ACCEPTANCE_EDGE = '1'
$env:E2E_BASE_URL = 'http://localhost:4000'
corepack pnpm exec playwright test e2e/layout-topbar.spec.ts e2e/acceptance-ui.spec.ts e2e/pm-workflows.spec.ts --workers=1
```

复用用户已启动的服务，没有新开端口、服务或数据库。新增验收测试只读取已有合成项目和任务，拦截业务变更请求；现有账号操作测试的临时 Session 仍由原测试创建并清理。

## 截图与交互证据

- [首页：无面包屑](../test-results/layout-step2a-home.png)
- [Atlas 看板：项目 / Atlas Release Readiness / 看板](../test-results/layout-step2a-board.png)
- [任务详情：项目 / Atlas Release Readiness / 看板 / Atlas delivery task 01](../test-results/layout-step2a-task.png)
- [项目列表](../test-results/layout-step2a-projects.png)
- [头像菜单：Enter 打开后，ArrowDown 将焦点移至登出](../test-results/layout-step2a-menu-keyboard.png)
- [切换后 Beacon 看板](../test-results/layout-step2a-board-beacon.png)
- [跨项目切换路径与 DOM 采样](../test-results/layout-step2a-switch-evidence.json)
- [窄屏任务详情](../test-results/layout-step2a-mobile.png)
- [窄屏头像菜单](../test-results/layout-step2a-mobile-menu.png)

跨项目测试使用实际客户端链接：Atlas 看板 → 项目列表 → Beacon 看板；MutationObserver 采样断言离开 Atlas 路径后不残留 Atlas 项目名。另验证浏览器后退至列表、再回 Atlas 后名称正确。

菜单测试覆盖 Enter/Space 打开、上下箭头、Escape 关闭并恢复焦点、Tab/Shift+Tab 移出、外部点击关闭、个人资料跳转。窄屏验证顶部栏高度、内容起点、无整页横向溢出和抽屉关闭后的焦点恢复。

所有截图已逐张视觉检查。test-results 被 Git 忽略；左下角圆形 N 来自现有 Next.js 开发指示器。

## 下一步

等待批次 A 通过后，再提交批次 B 的计划。其余页面的面包屑和返回按钮处理均未提前执行。
