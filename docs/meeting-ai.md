# AI 会议纪要与行动项闭环

会议转写稿通过 LangChain 流式生成可公开摘要，最终完整 JSON 经过 Zod 校验与控制标签清洗后存为 `MEETING_SUMMARY / PENDING`。不自动创建任务，不自动覆盖正文。原始转写稿不写入审计日志；保存输入哈希、模型、耗时、会议版本及生成 ID 以便追溯。

## 使用路径

1. 会议页填写标题、时间，点击“保存草稿并提炼”；正文可稍后补充。
2. 粘贴仅含合成数据的转写稿，确认 AI 处理，点击“AI 提炼纪要”。可以随时停止；切换会议或离开页面也会中断请求、模型调用和打字机定时器。
3. 摘要与行动项均为待确认建议。可“应用到纪要草稿”，也可仅将某一行动项人工转成任务，不代表同时批准整份摘要。
4. 转任务时确认标题、项目成员和日期。建议“张工”会初始化为“张”的本地搜索，不会自动指派。找不到时可显示全部成员。
5. 创建成功后显示“已转任务”，Toast 的“去看看任务”链接打开看板详情抽屉。通过本地事件、BroadcastChannel 和页面刷新通知看板、甘特图；重新聚焦页面也会重新拉取数据。
6. 定稿后正文只读。历史纪要默认定稿；修改时复制到新草稿，保留原记录。只有定稿记录可同步知识库。

## API 与一致性

- `POST /api/projects/:projectId/meetings`：兼容原接口，新增可选 `status`，省略时仍为 `FINALIZED`。
- `PATCH /api/projects/:projectId/meetings/:meetingId`：`save / apply / finalize`，必须传 `expectedVersion`；仅 PM、可写项目、可见会议、草稿可操作。
- `POST .../:meetingId/summarize`：`text / expectedVersion / syntheticDataConfirmed`。复用 SSE v1 的 `start/progress/delta/result/error/done`，按 `\n\n` 增量解包。`delta` 是未验证摘要，`result` 是已持久化的结构化待确认建议。`X-Generation-Id` 为结果 ID。
- `GET .../:meetingId/summarize`：恢复该会议最新的待确认建议；重新检查项目及会议可见性。
- `POST /api/projects/:projectId/tasks`：新增可选 `assigneeId / dueDate / meetingSource`，兼容旧调用。来源包含会议 ID、行动项 ID、可选建议 ID、预期版本和可见范围扩大确认。

任务创建、行动项 JSON 写入 TaskId、人工采纳审计、Task 审计在同一个 MySQL 事务中提交。锁顺序为项目 → 用户（UUID 排序）→ 会议业务记录，模型调用不占事务。项目锁串行化同一行动项的转换；先检查持久 TaskId，再校验版本，因此并发请求和丢失响应后的重试返回同一 Task。任何写入或审计失败整体回滚。

任务截止日期沿用排期模块的 UTC 日历日期规则，保存为该日 `23:59:59.999Z`；AI 解析“下周一”等相对日期时以会议日期、香港时区为参照。未知日期和无法唯一识别的负责人为 null，必须人工判断。

## 失败与降级

- 超过 8000 字，或保守预估超出 `AI_CONTEXT_WINDOW_TOKENS` 的 70%，在模型调用前返回 413：“文本过长，请分段提炼”。该预算是保守估计，并非供应商精确 tokenizer；部署时应填写实际上下文容量。
- 结构错误最多纠正两次，期间发送 `progress/retrying`。仅重试结构错误，供应商网络/认证错误不重复付费调用。仍失败则提示精简描述或手动整理。
- 前置鉴权/业务校验返回正常 HTTP 错误。流开启后的权限撤销通过 `error/UNAUTHORIZED` 通知前端，触发会话/能力刷新。落库事务重新查权限、项目冻结状态和会议版本。
- 取消时不保存半截输出。取消与数据库提交发生在同一瞬间时，已提交的完整建议仍可能存在；重新加载可恢复，不能将连接断开视为未提交证据。
- 创建成功但列表刷新失败，明确提示已创建，不诱导重复创建。

## 迁移与回退

`20261021000000_meeting_ai_drafts` 仅增加会议状态、版本号和 AI 类型。历史会议默认 `FINALIZED`、版本 1；不更新正文、不删除审计。迁移可重复执行，现有归档项目数据库触发器继续生效，无需更改 Milvus schema。

MySQL DDL 不能事务回滚。维护窗口先备份，优先保留新增字段。`down.sql` 在存在草稿或会议 AI 建议时主动拒绝结构回退，禁止强行删数据或缩减 enum。对已有新类型数据应保留本版本 API，只回退页面入口，或走前向修复，避免旧代码将草稿误当定稿。

## 验证方式

- 单测覆盖分片控制标签清洗、严格 JSON、纠错两次、纠错中取消、预算边界、模糊搜索、历史 JSON。
- 真实 MySQL 集成测试覆盖审计失败整体回滚、并发幂等、跨项目/负责人越权、版本冲突、权限撤销、草稿禁索引及归档直接 SQL 拦截。
- `node scripts/test-project-ia.mjs` 在独立测试库跑集成、全量浏览器 E2E 和真实 LangChain HTTP 流式夹具；不会向演示库写测试记录。模型夹具只使用合成数据，无外部模型费用。
- 截图位于 `test-results/meeting-ai-evidence/`，包括流式摘要、结构化卡片、负责人匹配、成功 Toast、纠错进度及权限撤销提示。

## 本次改动范围

- 模型与迁移：`prisma/schema.prisma`、`20261021000000_meeting_ai_drafts/{migration,down}.sql`。
- AI：`src/modules/ai/meetings/` 的提示词、预算/隐私校验、严格结构校验、生成服务及来源校验；复用现有 streaming 模块。
- API/事务：项目会议 summarize/PATCH 路由、任务 POST 路由，`assets/meeting-drafts.ts`、`tasks/meeting-source.ts`、`audit/service.ts`。
- UI：`meeting-ai-panel.tsx`、`meeting-draft-editor.tsx`、`action-item-task-dialog.tsx`、`meetings-manager.tsx`；Toast Action、看板详情 URL 和看板/甘特图跨标签页刷新。
- 验证：`meetings.test.ts`、`tests/integration/meeting-ai.test.ts`、`e2e/meeting-ai-streaming.spec.ts` 和现有 LangChain HTTP 模型夹具。

## 本次验收结果（2026-10-19）

- `pnpm lint`、`pnpm typecheck`、`git diff --check` 通过；`pnpm test`：79 个文件、499 项通过。
- 全量真实 MySQL 集成测试：169 项通过，2 项外部服务用例按原配置跳过。
- 全量普通浏览器 E2E：103 项通过；专用模型夹具下流式 E2E：13 项通过（含本次新增 5 项），合计 116 项。4 项依赖外部 Worker 的既有用例按原配置跳过；普通套件暂跳过的 13 项流式测试已在专用套件实际执行。
- 发现并修复空正文无法保存草稿，以及 textarea 精确标签随正文变化的问题；修复后完整流式专项再次通过。
- 在独立测试库重复执行迁移两次，会议及审计不变；含证据数据时 down.sql 拒绝结构回退。
- 演示库仅部署增量迁移，审计记录保持 115 条，未插入验收测试数据。迁移验证证据见截图目录的 `migration-verification.json`、`migration-safety.json`。
- 截图来自合成会议数据与本地模型协议夹具，实际经过 LangChain HTTP 流、MySQL 落库及人工确认转任务链路，无外部模型费用。
