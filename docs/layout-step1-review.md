# 全局布局步骤 1：待 Review

本步骤实现布局骨架、240px 固定侧边栏、移动端抽屉、角色导航，以及身份与异常外壳。未添加顶部栏或面包屑，未删除返回按钮。

## 行为与设计

- ADMIN：显示首页、项目、审计、用户管理、个人资料；QA 显示审计，不显示用户管理；PM/MEMBER 不显示这两个管理入口。
- 当前页面高亮；项目子页面和任务详情归属“项目”。底部保留当前用户、角色与登出。
- 窄屏默认隐藏侧边栏，通过菜单按钮展开；支持遮罩关闭、Escape、键盘焦点约束与关闭后焦点恢复。
- 服务端读取 getCurrentUser()，仅补查用户 name/email，传递给客户端布局组件。侧边栏负责入口显示，现有业务权限校验继续生效。
- 登录、注册页面不显示侧边栏。未登录访问受保护页面时隐藏业务内容，并跳转登录页面，保留 next 参数。
- 身份读取失败或页面加载异常时显示错误提示与重试入口，不显示侧边栏；已有局部错误提示通过布局上下文通知外壳。
- 使用现有 Tailwind、UI 组件与 lucide-react；没有新增依赖、API 或数据库变更。

## 本步骤涉及文件

新增：

- `src/components/layout/app-shell.tsx`
- `src/components/layout/app-sidebar.tsx`
- `src/components/layout/navigation.ts`
- `src/components/layout/navigation.test.ts`
- `src/components/layout/layout-failure.tsx`
- `src/app/error.tsx`
- `src/app/global-error.tsx`

修改：

- `src/app/layout.tsx`：接入全局外壳。
- `src/components/app-header.tsx`：改为服务端身份与布局入口。
- `src/components/app-header.test.ts`：身份、异常与外壳验证。
- `src/components/navigation-logout.tsx`：适配侧边栏外观。
- `src/app/profile/logout-button.tsx`：支持图标与样式，保留登出流程。
- `src/app/profile/page.tsx`
- `src/app/users/page.tsx`
- `src/app/login/page.tsx`
- `src/app/register/page.tsx`：以上页面接入错误外壳通知。
- `e2e/acceptance-ui.spec.ts`：更新导航断言，补充窄屏、未登录与截图验证。
- `docs/layout-step1-review.md`：本验收记录。

删除：

- `src/components/app-navigation.tsx`：旧导航由全局侧边栏替代；src 中已无引用。

工作区已有的其他改动保留，不计入本步骤清单。

## 验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：61 个文件、379 项测试全部通过。
- 现有 E2E 部分回归：`acceptance-ui.spec.ts` 与 `pm-workflows.spec.ts`，13 项全部通过。
- E2E 使用 `E2E_BASE_URL=http://localhost:4000` 复用用户启动的服务，设置 `ACCEPTANCE_EDGE=1`，单 worker；未启动新端口、未更改数据库或测试基础设施。
- `git diff --check`：通过，仅提示部分已有文件的换行符转换。
- 已视觉检查下列五张截图。

全量 E2E 尚未执行；按约定留到步骤 3。异常分支已通过单元测试验证，本次没有人为停止数据库进行故障演练。

## 截图

- [首页 ADMIN](../test-results/layout-step1-home-admin.png)
- [首页 MEMBER](../test-results/layout-step1-home-member.png)
- [项目看板 PM](../test-results/layout-step1-board.png)
- [窄屏收起](../test-results/layout-step1-mobile-collapsed.png)
- [窄屏展开](../test-results/layout-step1-mobile-open.png)

截图保存在本地 test-results（被 Git 忽略）。截图左下角的 Next.js 开发指示器来自现有开发服务。

## 下一步

等待步骤 1 Review。确认后再执行步骤 2：56px 顶部栏、用户菜单及面包屑；项目名中间层只显示文本，不链接至不存在的项目详情页。
