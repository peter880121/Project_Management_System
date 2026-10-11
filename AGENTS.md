# AGENTS.md — MedPM-AI

## 项目定位
MedPM-AI 是一个面向医疗软件交付场景的 **AI 原生合规与效率平台**。
它不是一个通用 Jira 克隆，而是围绕医疗软件交付的真实痛点，构建三个核心 AI Agent：
1. **智能 WBS 分解与工期预估 Agent**：基于历史项目数据，辅助需求拆解和排期。
2. **合规审计追踪 Agent**：主动发现需求-任务-测试链路断裂，生成可追溯的审计摘要。
3. **资源冲突与风险预警 Agent**：识别延期风险和资源冲突，提供决策建议，不自动修改状态。

项目目标：
- 展示医疗合规约束如何转化为系统设计；
- 展示 RAG + LLM 如何嵌入真实工作流；
- 展示可审计、可追溯、可人工确认的 AI 工程化能力；
- 作为我转型 FDE（Forward Deployed Engineer）的核心作品集。

## 我的角色
我是医疗软件项目经理，正在转型 FDE。
请把我当作需要理解“为什么这么设计”的开发者，而不是只给代码的机器。
每个重要设计请解释：业务约束、技术取舍、失败时的降级方式。

## 技术栈
- 前端：Next.js 15 App Router + TypeScript + Tailwind CSS + shadcn/ui
- 后端：Next.js API Routes，必要时拆出独立 Node 服务
- 数据库：MySQL 8 + Prisma（关系数据）
- 向量数据库：Milvus（向量检索，独立服务）
- 对象存储：MinIO（附件、需求文档、审计导出，Milvus 共用同一实例）
- 文档解析：MinerU（PDF → 结构化文本 → AI 输入）
- AI 层：LangChain.js，模型可切换 OpenAI / Anthropic / Gemini
- 缓存/队列：Redis（可选，用于风险预警异步任务）
- 测试：Vitest + Playwright
- 部署：Docker Compose
- 包管理：pnpm

## 架构原则
1. 模块化单体优先，不要过早微服务化。
2. AI 相关逻辑独立在 `src/modules/ai`，不要散落在业务代码里。
3. 向量检索封装独立在 `src/modules/vector`，业务代码不直接调用 Milvus SDK。
4. 审计日志是一等公民，不是事后补的日志。
5. RBAC 必须先于业务功能设计。
6. AI 输出必须可人工确认、可追溯、可回滚。
7. 所有 AI 生成的任务拆解、工期建议、风险预警，默认进入“待确认”状态。
8. MySQL 与 Milvus 通过业务 ID 关联，向量写入失败必须记录并支持重试。
9. 向量检索失败时降级为 MySQL 关键词检索，不阻塞主流程。

## 医疗合规约束
- 本项目只使用合成数据，禁止写入真实患者信息（PHI）。
- 关键操作必须记录审计日志：任务状态变更、权限变更、数据导出、AI 建议采纳/拒绝。
- 审计日志至少包含：actorId、action、entityType、entityId、before、after、ip、userAgent、createdAt。
- 为电子签名、21 CFR Part 11、GxP 审查预留接口和字段，不要求当前完整实现。
- 任何导出功能必须记录“谁在什么时间导出了什么范围的数据”。
- RAG 检索必须记录 query、命中 ID、耗时、是否降级，便于追溯 AI 输出来源。

## RBAC 角色
- ADMIN：系统管理、用户管理、全部审计查看
- PM：项目创建、任务分配、AI 建议确认
- MEMBER：任务执行、状态更新
- QA：审计查看、合规导出、测试链路追踪

## 数据库约定（MySQL）
- 业务数据用 MySQL 关系表，字符集 utf8mb4，引擎 InnoDB。
- 主键统一用 UUID（char(36)），不用自增 ID。
- 时间字段统一用 DATETIME(3)，存 UTC。
- JSON 数据用 MySQL 的 JSON 类型。
- Prisma 负责 schema、迁移和类型安全客户端。
- 所有涉及 MySQL 写入的操作必须在事务内完成。
- 复杂查询可写原生 SQL，但必须参数化，禁止字符串拼接。

## 向量数据库约定（Milvus）
- Collection 按业务类型划分，当前至少一个 `documents` collection。
- `documents` 字段：id, docId, projectId, embedding, createdAt。
- 索引使用 HNSW 或 IVF_FLAT，metric_type=COSINE。
- projectId 作为 scalar field，支持按项目过滤。
- embedding 维度 1536（与所选 LLM embedding 模型一致）。
- 写入顺序：先写 MySQL 拿到 docId → 再写 Milvus。
- Milvus 写入失败时，记录到审计日志或 sync_failures 表，支持重试。
- 检索失败时降级为 MySQL 关键词检索，并在审计日志中标记降级。

## 编码规范
- TypeScript strict 模式。
- 所有 API 输入用 Zod 校验。
- Prisma migration 必须可回滚、命名清晰。
- 业务逻辑与数据访问分离：`services` / `repositories`。
- 错误处理统一，不吞异常。
- 提交信息使用 Conventional Commits。
- 每次修改后运行：`pnpm lint`、`pnpm typecheck`、`pnpm test`。

## Codex 工作流
1. 先复述任务目标和验收标准。
2. 给出计划：涉及文件、数据模型、API、测试、风险。
3. 大变更先等待我确认；小变更可直接执行，但必须报告。
4. 执行后输出：
   - 变更摘要
   - 修改文件列表
   - 数据库迁移说明
   - 测试结果
   - 风险与下一步
5. 不允许自动合并到 main，所有变更走分支和 PR 思路。

## 任务模板位置
所有分阶段任务模板位于 `docs/prompts/`。
执行任务前，必须先读取对应 md 文件，并遵守其中的验收标准。
不要一次性读取或执行所有模板，按编号顺序逐个执行。

## 禁止事项
- 禁止硬编码 API Key、数据库密码。
- 禁止删除或弱化审计日志。
- 禁止生成真实患者数据。
- 禁止未经说明引入新依赖。
- 禁止把 AI 输出直接写入正式业务表而不经确认。
- 禁止为了“能跑”而绕过类型检查或测试。
- 禁止业务代码直接调用 Milvus SDK，必须通过 `src/modules/vector` 封装。