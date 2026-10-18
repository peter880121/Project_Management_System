# 项目引导与阶段信息架构

新建标准项目仍通过原事务创建 14 项任务与审计记录。前端创建成功后进入 `/members?onboarding=1`，引导 PM 配置访问授权，再进入 `/planning?onboarding=1` 分配负责人、维护日期与周容量，最后进入看板执行。引导参数仅控制提示，不代表人员配置已经完成，也不新增持久化状态。

视觉参考 [Jira 看板](https://www.atlassian.com/software/jira/guides/boards/overview)、[Linear 产品界面](https://linear.app/features) 与 [Asana 项目视图](https://asana.com/features)：使用清晰的分区标题、克制配色、统一卡片间距和逐层展开。六个交付阶段沿用本项目既有医疗软件 WBS 模板，不把状态列当成交付阶段，也不将这套行业交付模板宣称为通用 PMI 标准。

阶段标题显示 01–06 序号与任务数量，展开阶段使用浅青色强调；阶段内卡片省略重复阶段标签。提供全部展开/折叠，并保持每列独立滚动。甘特图增加阶段图例，列表行与时间条保持一一对应。

## 阶段解析与看板

- `src/modules/projects/task-phases.ts` 统一解析描述中的独立“所属阶段：”行，支持空格与中英文冒号。
- 标准阶段沿用模板顺序，自定义阶段保留出现顺序，缺失阶段放入“未分组”。
- 每个状态列独立折叠；待办默认只展开第一个有任务的阶段，其余状态默认展开。
- 状态更新成功后展开目标阶段、滚动定位并高亮任务 4 秒；保存失败保持原位置。已保存但刷新失败仍显示已提交的状态并明确提示。
- 同一看板刷新时按任务 ID 识别新任务，覆盖抽屉内人工采纳 WBS 建议后新增的任务；首次加载保持默认折叠规则，跨项目响应继续受请求代次隔离。
- 折叠使用带 `aria-expanded` / `aria-controls` 的按钮，折叠内容不进入键盘导航。

## 甘特图选择授权的降级方案

Frappe Gantt 没有独立的阶段标题行模型。插入合成任务行会同时影响任务索引、依赖图与拖拽事件，因此采用阶段前缀与阶段配色，**不增加阶段行、不提供阶段折叠**。

- 左侧列表与时间条保持同一份排序结果和真实任务 ID；标签显示 `[阶段] 任务名称`。
- 未排期任务同样带阶段前缀；已完成任务统一灰色并保持只读。
- 阶段信息使用现有任务接口一次批量查询，与排期请求并发发起；排期先返回即可展示。阶段请求失败或超过 5 秒时提示并按未分组展示。
- 迟到的阶段响应受请求代次隔离，不能覆盖其他周或卸载后的页面；拖拽过程中延迟刷新 SVG，保持正在拖动的节点。
- 保留完整依赖快照、`expectedVersion`、真实 409 后重新读取与物理回滚，不自动移动前置或后续任务。
- Frappe 的 `custom_class` 只接受一个类名，完成态与阶段色使用互斥类名，避免 `classList.add` 因空格抛错。

没有后端 API、数据库结构、迁移或依赖变更。

## 验证入口

```powershell
pnpm lint
pnpm typecheck
pnpm test
node scripts/test-project-ia.mjs
```

最后一条命令读取本地 MySQL 管理凭据，新建独立 `medpm_test_ia_*` 库，应用现有迁移并初始化合成夹具，再运行数据库集成测试、全量 E2E 和独立流式协议 E2E。不改写 `.env`，不向演示库写入夹具，不删除原审计记录。`NEXT_DIST_DIR` 隔离开发编译产物，避免覆盖正在运行的演示服务；测试结束恢复生成的类型引用配置。

全量 E2E 的对象存储使用既有 S3 协议夹具，实际经过 MinIO SDK，并验证字节一致性、失败注入与导出审计；流式专项使用既有模型协议夹具。它们不代表真实 MinIO / LLM 的在线验收。本轮首次连接本机真实对象存储时，上传与导出用例未通过，未修改存储业务 API；演示真实文件上传前需要另行排查存储连接。

仅重跑 E2E 可加 `--e2e-only`；追加 `e2e/gantt.spec.ts` 等路径可定向运行。隔离库保留以便核对回滚证据，不导出或记录生成的测试密码。

核心用例覆盖成员引导、默认折叠、移动后定位、高亮、阶段元数据失败降级、拖拽中途元数据返回、拖拽/缩放保存、依赖不联动、409 回滚及已完成/QA 只读。布局测试显式准备文档片段和通知夹具，避免依赖旧数据库中偶然残留的数据。

## 本次修改文件

| 范围 | 文件 |
| --- | --- |
| 阶段解析 | `src/modules/projects/task-phases.ts`、同目录 `task-phases.test.ts` |
| 成员引导 | `src/app/projects/create-project-form.tsx`、`src/app/projects/page.tsx`、`src/app/projects/[projectId]/members/page.tsx`、`src/app/projects/[projectId]/planning/page.tsx` |
| 看板与建议卡片 | `src/app/projects/[projectId]/board/task-board.tsx`、`wbs-panel.tsx`；`src/components/tasks/task-phase-group.tsx`、`task-card.tsx`、`board-types.ts` |
| 排期与甘特图 | `src/app/projects/[projectId]/planning/planning-panel.tsx`；`src/components/planning/planning-gantt.tsx`、`gantt-overrides.css`；`src/modules/planning/gantt-adapter.ts`、`gantt-adapter.test.ts` |
| E2E | `e2e/board-layout.spec.ts`、`gantt.spec.ts`、`pm-workflows.spec.ts`、`project-template.spec.ts`、`layout-topbar.spec.ts`、`traceability.spec.ts`、`task-ai.spec.ts` |
| 验收环境 | `next.config.ts`、`scripts/test-project-ia.mjs`、`scripts/test-ai-streaming-e2e.mjs`、`tests/fixtures/next-dev-server.mjs` |
| 说明 | 本文档 |

## 验收结果（2026-10-18）

- lint、typecheck 与脚本语法检查通过。
- 单元测试：70 个文件、440 项通过。
- 真实 MySQL 集成测试：123 项通过、2 项按配置跳过；包含审计写入失败后的业务回滚与结构回滚验证。
- 全量 E2E：93 项通过、8 项跳过；其中 4 项流式用例随后在明确的模型协议夹具环境中全部通过。合计 97 个不同用例通过，剩余 4 项文档解析/RAG/风险 worker 用例仍保持原有跳过条件。
- 截图与采纳后视口复核：额外 8 项通过，验证关闭抽屉后新任务至少 90% 进入可视区域。
- 最终全量与复核 runner 均以退出码 0 结束。测试使用独立合成数据库；没有新增迁移、删除业务审计或切换 `.env`。

证据目录：`test-results/ia-evidence/`。包含 `members-onboarding.png`、`board-collapsed.png`、`board-moved-highlight.png`、`gantt-phase-prefix.png`，以及单测、集成测试、全量 E2E 和复核日志。甘特图截图采用本文说明的阶段前缀与配色降级方案。
