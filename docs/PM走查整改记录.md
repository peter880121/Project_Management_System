# PM 走查整改记录

日期：2026 年 10 月 16 日。依据用户提供的《改进问题2.docx》，仅将其中的产品问题与页面需求纳入本轮整改。

## 问题与处理

| 项目 | 处理结果 |
| --- | --- |
| 创建项目没有明显反馈 | 创建项目移至独立页面。提交成功后返回项目列表，按当前有权查看的项目数据展示项目名称和成功提示；提供“进入项目”入口。 |
| 返回链接、标题与按钮重叠 | 返回链接取消外框并增加下方间距；新建需求表单增加分组间距；任务名称改为无外框文字链接。 |
| WBS 生成失败 | 历史记录仅存通用失败码，无法回溯具体字段。真实模型验证复现过结构校验失败，随后一轮生成的 8 条建议通过本地完整校验。增加 JSON 模式与字段/依赖约束，结构失败最多纠正一次，仍无效则不保存建议。认证、限流、超时、结构失败分开记录安全错误码并返回中文提示。 |
| 检索降级与生成失败混在成功提示中 | 生成失败使用错误提示，保留需求输入和确认状态，提供手动创建入口；关键词检索降级单独说明，不将其等同于生成失败或成功。 |
| 排期布局重叠 | 任务标题、状态、负责人、版本分组展示；日期和工时改为桌面三列、窄屏单列。统计周及容量控件适配窄屏。 |
| 第二条任务保存参数无效 | 使用文档对应的两任务状态、版本及日期搭建无业务写入的浏览器复现，整改前后连续保存均通过，尚未证实原现场根因。增加表单级序列化、前后端一致的逐字段校验与中文原因，避免只提示“排期参数无效”。 |
| 项目和任务状态不突出 | 项目页突出规划中、进行中、已暂停、已完成统计和筛选，项目卡片展示阶段；项目内突出四类任务统计和四列看板。 |
| 创建模块占据主页面 | 创建项目、创建任务均使用独立页面；WBS 与风险也移至独立工作页面，通过项目功能导航进入。 |

## 页面入口

| 页面 | 路由 | 主要权限 |
| --- | --- | --- |
| 项目状态总览 | `/projects` | 当前可访问项目，ADMIN 可查看全部 |
| 创建项目 | `/projects/new` | PM |
| 项目任务状态看板 | `/projects/[projectId]/board` | 有项目访问权的用户 |
| 创建任务 | `/projects/[projectId]/tasks/new` | 有项目访问权的 PM/ADMIN |
| WBS 与工期建议 | `/projects/[projectId]/wbs` | 有项目访问权的 PM |
| 风险预警与扫描计划 | `/projects/[projectId]/risks` | 有项目访问权的 PM |

风险通知详情的处置链接、首页 Agent 文案、角色演示流程和已有浏览器测试入口已同步。页面隐藏与服务端权限检查同时保留。

## 文件范围

- 项目总览及创建：`src/app/projects/page.tsx`、`src/app/projects/create-project-form.tsx`、`src/app/projects/new/page.tsx`、`src/modules/projects/status-display.ts`。
- 任务看板及创建：`src/app/projects/[projectId]/board/page.tsx`、`task-board.tsx`，以及 `src/app/projects/[projectId]/tasks/new/page.tsx`、`task-form.tsx`。
- 项目工作区：`src/components/page-back-link.tsx`、`project-navigation.tsx`、`project-workspace.tsx`；`src/app/projects/[projectId]/wbs/page.tsx`、`risks/page.tsx`。
- WBS：`src/modules/ai/chat-model.ts`、`src/modules/ai/wbs/failure.ts`、`prompt.ts`、`service.ts`、WBS API 和面板。
- 排期：`src/modules/planning/form-input.ts`、排期 API 和 `planning-panel.tsx`。
- 样式与入口：`src/app/globals.css`，通知列表/详情、文档页/引用详情、成员页、追溯页及任务详情中的返回/任务链接，追溯创建表单，首页文案。
- 验证：`src/modules/ai/wbs/generation.test.ts`、`src/modules/planning/form-input.test.ts`、`src/modules/ai/provider-config.test.ts`；`e2e/pm-workflows.spec.ts`、`acceptance-ui.spec.ts` 及 tasks/traceability/planning/risk-scheduler 的旧入口适配。
- 演示文档：`docs/角色分模块演示流程.md`。

## 验证与限制

- lint、typecheck 通过；60 个单元测试文件，372 项测试通过。
- Edge 浏览器回归 13 项通过，包含新创建流程、状态总览、两任务连续保存、WBS 待确认依赖、失败反馈及角色导航。
- 已检查项目总览、任务看板、桌面/手机排期和 WBS 失败页截图。
- 真实模型结构验证使用本地配置的 `qwen-flash` 和独立合成输入，不包含用户项目文档，不写入正式任务或建议。一次出现结构校验失败，随后一轮 8 条建议通过完整校验；模型依然可能失败，系统没有保证每次成功。
- 浏览器业务写请求均被拦截模拟，未新建业务测试项目/用户；账号互斥测试仅使用自己创建并清理的临时会话。
- 未执行会污染当前演示库的全量旧 E2E；已更新其受影响入口。未执行生产构建。
- 无数据库迁移、无新增依赖；既有审计记录保留，建议仍待 PM 确认，不自动落正式任务。
- 第一次现场排期 400 的具体触发字段未获得，不能声称根因已经确认。请以当前页面的字段级反馈复核原操作。

建议本地提交信息：`fix(pm): prioritize delivery status and isolate creation workflows`。本轮未自动提交、推送或合并。
