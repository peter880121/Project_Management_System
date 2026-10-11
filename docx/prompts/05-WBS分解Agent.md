任务：实现智能 WBS 分解与工期预估 Agent。

业务目标：
输入一段自然语言需求描述，Agent 自动检索历史项目数据，生成结构化任务列表，包含 title、description、estimateHours、dependencies、suggestedRole，并给出工期建议。所有输出进入 AiSuggestion 表，状态为 PENDING，等待 PM 确认。

技术要求：
- 使用 LangChain.js 调用 LLM。
- 先通过 Milvus 检索相似历史任务，作为 RAG 上下文。
- 检索结果必须包含历史任务的实际工时和交付速度。
- 通过 src/modules/vector 封装调用 Milvus，业务代码不直接调用 SDK。
- 输出必须写入 AiSuggestion 表，不得直接写入 Task 表。
- 记录 AI 调用审计：输入摘要、模型、耗时、检索命中 ID、是否降级、采纳结果。
- Milvus 检索失败时降级为 MySQL 关键词检索，并在审计日志中标记降级。
- LLM 失败时降级为返回空建议并提示人工创建。
- 前端展示“依据的历史任务”供人工判断。
- PM 可对每条建议单独采纳或拒绝，采纳后转为正式 Task 并写审计。

验收标准：
- 不直接写 Task 表。
- 审计日志包含 AI 建议采纳/拒绝。
- 有单元测试 mock LLM 和 Milvus。
- 有失败降级测试。
- 前端展示“依据的历史任务”供人工判断。
- 支持部分采纳（逐条任务）。

输出：计划、变更文件、prompt 设计、测试结果、风险。