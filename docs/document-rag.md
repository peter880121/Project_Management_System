# 文档 RAG 与 WBS 证据

目标：已成功解析的合成 PDF 可被项目内检索，并为 WBS 提供版本化需求证据。先保证 MySQL 中的证据可查，再由独立进程同步向量；远程服务失败不影响原 PDF 下载或关键词检索。对应 `docx/prompts/05-WBS分解Agent.md` 的检索降级、人工确认和来源展示要求。

## 数据与运行

新增迁移 `20261015030000_document_chunks`：Document.chunkedVersion、DocumentChunk 表。UUID 主键、UTC DATETIME(3)、utf8mb4/InnoDB，分块和审计同事务。应用 `pnpm db:generate`、`pnpm db:deploy`，启动应用及 `pnpm documents:worker`，确保 system user 已 seed。原有成功解析结果会自动补分块；LEGACY parsedText 不自动视为成功解析证据。

分块优先使用 MinerU 结构化文本、表格及图片说明；没有可用块时使用 Markdown，页码为 null。每块最多 2000 UTF-16 字符、重叠 200 字符，不跨结构块拼接，不切断 surrogate pair，最多 20000 块。保留 documentId、解析版本、parseJobId、页码、原块索引、字符起止和文本 SHA-256。独立结构块可能很短；当前不是语义标题分块器，也不索引图片像素。分块器标识 blocks-v1 写入审计。

超出分块数量限制时记录 DOCUMENT_CHUNK_BUILD 失败及审计，隔离当前版本，其他文档继续处理。页面显示失败原因，允许管理员/PM 显式重试；优先拆分原文档，未经修改的超限内容再次处理仍会失败。重新解析的新成功版本不受旧版本失败记录影响。

Worker 先原子写 MySQL 分块及发布 chunkedVersion，随后通过 OpenAI 或其兼容接口生成 1536 维 embedding，幂等 upsert 到 Milvus `documents`；向量主键是 chunkId，docId/projectId 为过滤字段。向量集合使用 COSINE/HNSW。模型名称随块固化，重试不静默切换模型。查询只接受当前配置模型的 SYNCED 向量；更换模型后应重新解析生成新版本，旧模型证据仍可关键词检索。历史任务向量尚未保存模型标识，更换模型后须重新同步历史任务，不能认为旧向量已兼容新模型。

同步使用 60 秒租约和随机 token，单次远程处理等待上限 40 秒；过期 worker 不能发布状态，重复向量写使用相同 ID 和不可变内容。失败写入 SyncFailure 和审计，指数退避，五次后停止自动重试；PM/ADMIN 可重新排队失败分块。查询不会触发 embedding 补写。索引错误只保存安全代码，不保存服务原始报错。SDK 初始化失败会释放客户端供后续连接恢复，关闭默认 debug 请求日志。

分块回滚脚本 `down.sql` 会删除分块表，须先停应用和 worker、备份分块证据；解析原文和审计保留，可重新生成分块。需要同时回滚解析迁移时，先回滚本迁移。外部 Milvus 不随 SQL 回滚清空；所有命中必须经 MySQL 校验，孤立向量不会作为证据返回。

## API 与页面

- `POST /api/projects/<projectId>/documents/search`：全部当前角色可读。JSON `{query, limit?: 1..12, documentId?: UUID, version?: positiveInt}`；指定历史版本必须同时指定文档。默认检索各文档最新成功解析版本，重解析失败时保留上次成功版本。关键词最多 12 项，中文包含有限双字组合。
- `GET /api/documents/<id>/index`：分块是否就绪及最新成功版本 PENDING/SYNCED/FAILED 计数。
- `POST /api/documents/<id>/index`：PM/ADMIN 提交 `{version}`，返回 202；仅重置当前成功版本的失败分块，并记录人工重试审计。
- `/projects/<projectId>/documents`：检索、带版本和页码的结果、就绪状态、失败重试。
- `/projects/<projectId>/documents/chunks/<chunkId>`：不可变引用正文、版本、页码、块范围、哈希及原 PDF 下载入口；历史版本明确提示。

embedding、向量检索及 MySQL 命中回查的总等待上限为 1500ms，超时、失败、无有效命中均降级为 MySQL 关键词检索。该上限不含后续关键词查询及审计事务，也不会取消已发出的远程请求；晚到的 embedding 不再触发向量查询。关键词检索是有限条数的参数化 LOCATE 查询，当前没有全文索引，规模增大后需评估性能。Milvus 最多取 64 个候选，旧版本较多时可能回查为空并降级。

向量命中必须经 MySQL 再核对项目、文档、版本、模型及状态，不直接信任向量元数据。每次检索记录 RAG_SEARCH：query、命中 chunk ID、文档版本和哈希、耗时、模式、降级原因、actor/IP/userAgent。审计失败不返回未经记录的证据。当前沿用全局 RBAC，尚无项目成员级权限隔离。

## WBS

历史任务检索与文档检索并行，最多提供 4 块文档上下文。历史实际工时/交付时间与文档需求/验收条件分开输入。Prompt 明确文档文本是不可信资料，禁止执行文档内指令或编造引用。

模型可按任务返回 sourceChunkIds，只允许来自实际提供的证据；出现未知 ID，整批降级为空建议及手动创建入口。每条 AiSuggestion.input 保存原始文档证据快照、版本、哈希和检索状态，output 保存任务引用 ID。刷新后仍展示当时的快照，新解析不会覆盖。页面区分“提供了上下文”与“模型标注引用”，两者均需人工核对，ID 校验不能证明文字语义正确。

建议默认 PENDING，只有 PM 明确采纳后才创建 Task，引用和原建议保留。不自动创建 Requirement，也不替代 QA 版本复核；新文档版本出现后，历史建议仍允许人工核对并采纳，来源页面提示历史版本。

## 验证范围与待验收

2026-10-15 已使用本地百炼 OpenAI 兼容配置通过真实 embedding、Milvus、WBS 联合验收：text-embedding-v4 返回 1536 个有限浮点数，三个合成文档完成真实向量同步；语义查询首位命中账号锁定证据。最近一轮查询耗时 776ms，未降级。qwen-flash 在约 11.4 秒内生成七条待确认建议，同时读取三份文档证据及一条历史任务（实际工时 8 小时、交付 2 天），两路检索均未降级。引用均来自实际提供的分块，没有生成正式新任务，检索和生成均留审计。上述耗时是单次样本，不是性能保证。

测试用真实服务处理合成的结构化解析 fixture，MinerU/MinIO 的真实链路另有验收；本次没有重新调用 MinerU。结果证明小样本的接口和证据链可运行，不代表复杂文档、所有语义查询或模型建议质量都已验收。模型语义正确性仍需人工确认。

配置：AI_PROVIDER=openai 表示调用协议，兼容服务不要求是 OpenAI 品牌。AI_MODEL 优先于 LLM_DEFAULT_MODEL，再使用代码默认值；OPENAI_BASE_URL 显式传给聊天与两种 embedding 客户端。百炼示例为 https://dashscope.aliyuncs.com/compatible-mode/v1、AI_MODEL=qwen-flash、OPENAI_EMBEDDING_MODEL=text-embedding-v4。维度固定 1536，embedding 使用 float 编码，参见 [百炼官方向量接口说明](https://www.alibabacloud.com/help/zh/model-studio/text-embedding-synchronous-api)。密钥只存本地 .env 或部署密钥存储，Compose 已传递相应配置。当前聊天温度固定 0；LLM_DEFAULT_TEMPERATURE、ITEM_MODEL、VL_MODEL 尚未接入业务。

本轮修复历史任务适配器的 SDK 平铺/嵌套结果兼容和状态码检查；此前有向量命中时可能错误降级。文档索引分块固化了模型名，因此配置从 text-embedding-3-small 改为 text-embedding-v4 后，原分块不会被悄悄重写；重新解析可产生适用新模型的新版本，旧内容仍可关键词检索。

单元测试覆盖分块边界、页码/哈希、慢 embedding/向量请求降级、SDK 状态码及初始化拒绝处理、引用 ID 验证。隔离 MySQL 测试覆盖版本/项目/模型过滤、重试上限、租约恢复、审计回滚、结构回滚和 WBS 待确认后采纳。浏览器 RAG 测试使用合成解析结果 fixture + 真实 MySQL/应用/Worker，验证来源页、检索审计及 QA 权限；真实 MinerU/MinIO 另见 document-parsing.spec.ts。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/document-rag.test.ts
# 需要真实 Milvus 网络权限；使用合成向量，不调用 embedding 模型
# PowerShell: $env:RUN_LIVE_DOCUMENT_VECTOR = '1'
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/document-rag.test.ts
# 先运行应用和文档 worker，再配置 E2E_BASE_URL
pnpm exec playwright test e2e/document-rag.spec.ts --workers=1
# 真实模型联合验收（仅显式开启时调用云服务）
# PowerShell: $env:RUN_LIVE_AI = '1'
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/ai-live.test.ts
```

2026-10-15 真实局域网 Milvus 适配器已通过合成向量写入、检索和项目隔离测试，测试只清理自己创建的向量；没有删除集合。沙箱曾以 EACCES 拒绝连接，允许网络访问后通过。该结果不证明真实 embedding 的语义准确性。

真实 AI 测试仅将 Prisma 重定向到随机的本地隔离测试库，embedding、文档/历史向量同步、检索及聊天均使用生产适配器，不 mock 模型。结束时删除该测试库和自行创建的文档/历史任务向量，不删除共享集合，不改动已有项目。运行需允许访问云服务和局域网 Milvus。静态检查和单元测试不调用云服务。

后续按原计划补齐排期/人员容量数据维护，再推进风险自动扫描、合规导出和项目权限隔离。

## 本阶段修改文件

| 范围 | 文件 |
| --- | --- |
| 数据 | prisma/schema.prisma；prisma/migrations/20261015030000_document_chunks/{migration.sql,down.sql} |
| 文档 RAG | src/modules/documents/{chunking,rag-repositories,rag-service,rag-worker}.ts；parse-worker.ts |
| 向量与模型 | src/modules/vector/{client,documents}.ts；src/modules/ai/embeddings.ts |
| API | src/app/api/projects/[projectId]/documents/search/route.ts；src/app/api/documents/[documentId]/index/route.ts |
| 页面 | src/app/projects/[projectId]/documents/{page,parse-panel,search-panel,index-panel}.tsx；chunks/[chunkId]/page.tsx |
| WBS | src/modules/ai/wbs/{service,types,prompt}.ts；src/app/api/projects/[projectId]/ai/wbs/route.ts；board/wbs-panel.tsx；src/modules/audit/service.ts |
| 测试 | chunking.test.ts、rag-service.test.ts、vector/{client,documents}.test.ts、wbs.test.ts、tests/integration/document-rag.test.ts、document-parsing.test.ts、e2e/document-rag.spec.ts |
| 配置与说明 | docker-compose.yml、.env.example、README.md、src/modules/documents/README.md、本文 |

建议提交信息：`feat(documents): add versioned RAG and WBS document evidence`。本阶段没有新增依赖，没有提交或合并到 main。
