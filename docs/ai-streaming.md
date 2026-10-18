# 任务级 AI 流式生成

## 接口与协议

原生 ReadableStream + SSE + LangChain `.stream()`，无新增依赖和数据库迁移。WBS POST `/api/projects/[projectId]/ai/wbs` 与合规 POST `/api/audit/summary` 在 `Accept: text/event-stream` 时返回流；未声明该 Accept 的调用方维持 JSON 响应。任务上下文和敏感输入检查在开流前执行。

客户端以 `X-Generation-Id` 传 UUID，服务端校验并通过响应头及 start/result 事件回传。事件按 `event: ...\ndata: JSON\n\n` 编码：

| 事件 | 内容 | 语义 |
|---|---|---|
| start | generationId, version=1 | 本次生成标识 |
| progress | stage, message | 程序实际执行阶段 |
| delta | text | 未校验的公开执行说明，纯文本预览 |
| result | generationId, payload | 结构化结果已校验并提交；业务建议仍为 PENDING |
| error | code, status, message, retryable | 安全的流内错误；权限变化为 UNAUTHORIZED |
| done | outcome=completed/failed | 终止事件；客户端不能把普通 EOF 当成功 |

每 10 秒发送心跳注释；响应禁缓存、禁代理缓冲。前端 TextDecoder 增量解码 UTF-8，保留未完成事件，按空行拆事件、按换行拆字段，同时支持 CRLF 和多行 data；对异常协议和大小设限。网络分片与 SSE 事件没有一一对应关系。

## 模型输出与保存边界

首次调用先输出 `<PUBLIC_PREVIEW>` 后的简短公开说明，再输出 `<RESULT_JSON>` 后的 JSON；若模型直接返回 JSON，则仅进入结果校验，不显示 JSON 预览。服务端增量状态机持有可能的标签尾部，支持 `<PUB` / `LIC_PREVIEW>` 分片；重复协议标签和其他 XML 标签被移除，`internal`、`think`、`analysis` 等私有块连同嵌套内容被遮蔽。未闭合或错配私有块按无效格式处理。清洗只打印固定的 `AI_CONTROL_TAGS_CLEANED` 警告，不记录模型内容。该说明不请求或展示内部推理，不作为审计结论。

结构化结果先递归清洗模型生成的字符串，再通过 Zod、任务数量、依赖及引用校验。来源证据和审计快照不改写；若来源本身含控制标记，保存前拒绝整批，避免污染新记录。Few-shot 示例明确数字工时、角色枚举、零基依赖索引和合法引用。首次格式失败后最多纠正两次：发送 `progress`，`stage="retrying"`，UI 显示“正在重试…”及当前轮次；纠错调用使用 JSON 模式和精简指令，只返回完整合法 JSON，不重播预览。两轮仍失败则发送 `MODEL_RESPONSE_INVALID` 错误和 `done: failed`，提示“当前需求描述可能过于复杂，AI 未能生成标准结构，请精简描述或手动创建。”，不返回成功结果或保存半成品。鉴权、限流等供应商错误不进入格式纠正。合规结果仍由规则发现和经过引用校验的模型摘要组成，模型失败保留确定性规则降级。

模型调用在事务外；最终事务重新校验角色、项目访问和来源任务版本，原子保存 AiSuggestion 和生成审计，不直接创建正式 Task。原采纳/拒绝及 QA 复核流程保留。

## 取消、超时与错误

停止、关闭抽屉、切换任务/模式及组件卸载会 abort 请求、使旧生成版本失效，并清空单个打字机定时器和待显示字符。请求中断/ReadableStream.cancel 传递到首次调用和每轮纠错的 AbortSignal 与迭代器；模型超时 30 秒会同时 abort 上游与结束本地等待，整个响应设置 90 秒期限。取消不纠错、不生成降级建议；记录 `AI_GENERATION_CANCELLED`，若权限撤销导致取消审计本身不能写入，输出不含上下文的安全日志。

开流前的鉴权和业务错误用 HTTP 4xx/5xx。开流后无法修改 HTTP 状态，必须发送 error 事件；UNAUTHORIZED 会清空未校验预览、停止动画、显示 Toast，并重新获取 `/api/auth/me`：401 跳登录页，仍有会话则刷新页面权限。其他错误不会暴露异常堆栈或服务凭据。

断开连接不能撤销已经提交的事务，也不能保证供应商对已生成 Token 不计费。停止后提供“核对已保存结果”：WBS GET 支持 generationId（匹配 input.batchId）；任务合规 GET `/api/audit/summary?projectId=...&taskId=...&generationId=...` 只返回对应项目/任务的摘要，并保持项目授权检查。用户可确认已提交结果，避免把网络中断误认为没有保存。检索服务已有的外部调用可能先完成，但取消后不会继续发起主模型生成或保存。

## 文件清单与验证

- `src/modules/ai/streaming/`：协议、模型状态机、SSE 响应、客户端解析及动画工具、单元测试。
- `src/modules/ai/wbs/service.ts`、`compliance-audit/service.ts`：生成、取消检查和事务边界。
- 两个 POST route：内容协商、预检查、流式响应与批次核对 GET。
- `src/modules/audit/service.ts`：新增取消审计动作。
- `src/components/use-ai-generation.ts`、`ai-generation-preview.tsx`、`task-ai-drawer.tsx`、`src/app/projects/[projectId]/board/wbs-panel.tsx`：请求生命周期、预览与最终结果。
- `tests/integration/ai-streaming.test.ts`：真实 MySQL 校验待确认保存、权限撤销、审计回滚及取消。
- `tests/fixtures/ai-stream-server.mjs`、`scripts/test-ai-streaming-e2e.mjs`、`e2e/ai-streaming.spec.ts`：显式合成模型协议验收，使用真实 LangChain HTTP 流、应用、MySQL 和浏览器，不依赖外部模型。
- `e2e/task-ai.spec.ts`：将原“关闭后继续等待响应”用例改为验证请求中止及任务切换。

执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；本地全量集成与浏览器验收使用 `node scripts/test-project-ia.mjs`，自动创建、迁移并初始化独立合成测试库，不修改 `.env` 或活动演示库。该 runner 串行运行集成测试、普通 E2E 和显式流式协议 E2E，避免争用 `.next`。八项协议用例在普通全量 E2E 中按配置跳过，随后由 fixture runner 单独执行。

截图保存在 `test-results/ai-streaming-evidence/`：生成中和停止按钮、流内权限撤销 Toast、已提交的待确认结构化卡片。截图使用合成协议模型；真实供应商的断连与计费行为仍需部署环境验证。

## 2026-10-18 清洗与纠错修复

- 清洗：`streaming/clean-text.ts`、`model.ts`、`clean-text.test.ts`、`protocol.test.ts`。
- 结构与重试：`wbs/prompt.ts`、`service.ts`、`failure.ts`、`generation.test.ts`、`streaming-safety.test.ts`；合规摘要服务共享清洗层。
- 流内错误与 UI：WBS POST route、`streaming/response.ts`、`use-ai-generation.ts`、`ai-generation-preview.tsx`。
- 真实数据库与浏览器：`tests/integration/ai-streaming.test.ts`、`tests/fixtures/ai-stream-server.mjs`、`e2e/ai-streaming.spec.ts`。
- 无数据库迁移，无新增依赖；AI 建议仍需人工采纳。
- lint、typecheck 通过；72 个单元测试文件、457 项测试通过。
- 全量真实 MySQL 集成：127 项通过、2 项按配置跳过；其中流式集成 10 项全部通过。
- 全量浏览器回归：93 项通过；8 项流式协议单独执行通过，合计 101 项通过。剩余 4 项依赖未启用的文档/风险 worker，按配置跳过。首次流式运行发现夹具提前 release 的时序问题，修复后通过 `node scripts/test-project-ia.mjs --stream-only` 在新独立库重跑全部 8 项。
- 日志：`test-results/stream-clean-unit.log`、`stream-clean-acceptance.log`、`stream-clean-rerun.log`。对象存储使用 S3 协议夹具；模型使用合成 HTTP 协议夹具，不代表真实供应商或 MinIO 连通性验收。
- 截图：`test-results/ai-streaming-evidence/05-retrying-clean-preview.png` 展示纠错提示与停止按钮；`06-corrected-clean-cards.png` 展示干净的待确认卡片及成功 Toast。`clean-persisted-suggestions.json` 是浏览器操作后从真实 MySQL 读取的三条 PENDING 记录，均记录一次成功纠错且不含控制标签或内部内容；该次生成未创建正式 Task。
