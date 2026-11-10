# 智能助手：三层回答与外发隔离

登录后的 `/` 是所有角色共用的智能助手，侧栏统一命名为“智能助手”。PMO 数据决策中心继续独立保留。问答只读，不创建任务或自动采纳业务变更。

## 模式与意图边界

| 模式 | 行为 | 无证据或服务故障 |
| --- | --- | --- |
| 智能模式 SMART | 内部事实和联系人优先内部检索；明确的概念、方法问题走通用知识 | 内部缺失明确告知；需要时效性资料时引导切换联网，不自动外发 |
| 仅内部资料 INTERNAL | 只使用授权的内部账号及项目知识 | 没有证据即说明未找到，不回退通用知识 |
| 联网研究 WEB | 每次发送前确认搜索词，再检索外部资料 | 搜索失败或限流明确提示，不伪造联网结论 |

所有模式先执行实时业务意图拦截。询问任务数量、当前进度、逾期列表、负荷排名等，系统直接返回：

> 当前助手暂不支持直接查询实时业务报表，请前往『项目看板』或『数据决策中心』查看。

该分支不调用模型、内部检索或外部搜索。这里采用保守规则路由，没有 SQL Agent；复杂、含糊的问题建议直接在业务页面核对。

通用知识回答必须以“以下基于通用行业知识，未经验证项目库”开头，总计不超过 300 个 Unicode 字符。服务端固定前缀并检查长度；模型不接收内部资料或历史。内部制度、项目专名及前文追问不会作为通用知识回答。联系人即使在联网模式仍优先内部账号资料，不向外网找同名人员。

## 联网确认与外发最小化

联网输入框始终显示：

> ⚠️ 联网模式会将您的提问发送至外部搜索引擎，请勿输入项目敏感代码或医疗数据。

首次 POST 返回 HTTP 428 / `EXTERNAL_SEARCH_CONFIRMATION_REQUIRED`，包含规范化后的实际搜索词、风险提示、有效期和确认令牌。此时没有创建消息，也没有调用搜索服务。弹窗默认不勾选确认，取消后返回原提问；项目专有词（如 Y市HIS）使用“您的问题包含项目专有名词，确认要向外网发送吗？”提示。

确认令牌使用 SESSION_SECRET 的 HMAC-SHA256 签名，有效期 5 分钟，绑定用户、角色、会话、项目范围、问题、请求 ID、版本及模式。修改输入、换会话或过期后必须重新确认。浏览器自行传一个布尔值无法绕过。明显患者标识或凭证先行拒绝；规则检测不能代替人工脱敏。

只有规范化后、在弹窗中展示的当前问题发送给搜索引擎。内部检索片段、项目名单、联系方式、历史对话均不随之发送。联网回答模型也只接收当前问题及外部网页摘录。服务端先提交外发确认与搜索开始审计，再发出请求；审计失败则禁止外发。既有内部 RAG 会将必要的授权片段发送给配置的 AI 模型，用户仍需勾选合成数据声明。

搜索使用原生 fetch 接入 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)，无需增加 SDK、依赖或常驻服务。默认基础搜索，最多 5 条来源，10 秒超时、响应体限额、禁止重定向。法规及医疗标准问题限制官方域名，拒绝内网/带凭证的来源 URL。来源展示网页链接、检索时间及提供方给出的发布日期；没有发布日期则明确显示未提供。网页正文视为不可信证据，不执行其中指令。

## 内部知识与权限

联系方式先查维护的内部账号姓名与邮箱，范围由项目 owner/active membership 决定。ADMIN 沿用管理权限；PMO 的全局统计权限不等于读取所有文档。重名返回候选；电话未维护就说明缺失，不编造。

知识来源包括项目文档、已批准交付物、定稿会议正文、可访问且已解析的会议附件。上传不等于已入知识库：文档和会议附件需申请解析，会议正文需同步知识库。PDF 继续要求云端处理确认。

Milvus `documents_v2` 按授权 projectId 与角色预过滤，命中后回 MySQL 复核最新权限、审批/定稿状态、解析版本及文本哈希。向量故障降级为同权限范围的 MySQL 关键词检索，不扩大范围。每轮最多 8 条来源、每文档 3 段、总证据正文 12,000 字符。内部模型只使用核验后的证据及有限的内部历史；通用和联网回答不作为内部事实依据。

流前、检索后、生成中及提交事务再次检查权限。撤权后停止生成并清空预览，历史中的受限来源会隐藏。已经发送到客户端或模型的内容无法追溯撤回。

## API、SSE 与一致性

- GET/POST `/api/assistant/conversations`：分页列表与创建。
- GET/PATCH `/api/assistant/conversations/:id`：读取消息、重命名或隐藏；保留原始审计。
- POST `/api/assistant/conversations/:id/messages`：严格 Zod 校验 `mode`、问题、requestKey、expectedVersion、syntheticOnly 及可选 webConfirmationToken。缺省 mode 为 INTERNAL，兼容旧客户端。
- GET `/api/assistant/scope`：授权项目。

沿用 start/progress/delta/result/error/done SSE 协议，兼容 UTF-8 半包、粘包与控制标签清洗。HTTP 前置校验完成后才开流。停止或离开页面会取消 fetch、模型、外部搜索及打字机定时器，不保存半截回答。每个会话只允许一个活跃请求、每用户最多两个，90 秒流上限及 120 秒租约兜底。

回答、来源、完成审计同事务提交。提交后网络中断，客户端按 requestKey 恢复已保存结果，不重复搜索或创建消息。网页只读引用保存原始检索片段与哈希，不假定网页将来保持不变。

## 模型、迁移与运行

沿用 AI_PROVIDER / AI_MODEL 和现有模型密钥。联网在根目录 `.env` 配置服务端 `TAVILY_API_KEY`，保存后重启 Next.js 应用即可启用，没有管理页面开关。`TAVILY_BASE_URL` 可填写 `https://api.tavily.com` 或可信代理的基础地址，代码会补 `/search`；已经以 `/search` 结尾则不重复拼接。可选的完整接口地址 `TAVILY_SEARCH_URL` 优先级更高，留空时使用 Base URL。密钥缺失时明确提示“尚未配置”，内部与通用模式照常工作。不要将密钥暴露为 NEXT_PUBLIC 字段。正常运行无需新增服务。

欢迎页将标题、输入框和快捷提问集中在内容区中央，开始对话后切换为可滚动消息与底部输入框，始终只保留一个输入表单，避免模式、问题或勾选状态被不同表单覆盖。小屏内容允许纵向滚动。

`20261027000000_rag_assistant` 创建 RagConversation、RagMessage、RagCitation。`20261028000000_assistant_modes` 仅增加消息 mode/intent/webQuery 与引用 webUrl/retrievedAt/publishedAt，支持重复执行。历史消息默认为 INTERNAL，正文及业务证据不改写。回滚脚本在发现新模式或外发审计证据时拒绝破坏性回滚。原有项目冻结触发器不变；问答是独立只读会话活动。

测试使用独立 MySQL、真实 LangChain HTTP 流及本地搜索协议夹具，不调用付费搜索。覆盖五角色、内部优先、通用声明与长度、所有模式实时数据阻断、确认前零外发、令牌篡改/过期、上下文隔离、网页来源、搜索失败/停止、权限撤销、事务审计回滚及断流恢复。

## 关键修改位置

| 文件 | 责任 |
| --- | --- |
| `src/modules/ai/assistant/routing.ts` | 三模式意图路由、固定系统提示与实时业务查询阻断 |
| `src/modules/ai/assistant/web-confirmation.ts` | 搜索词预览、HMAC 绑定与有效期、输入限制 |
| `src/modules/ai/assistant/web-search.ts` | Tavily 适配、取消、超时、来源过滤 |
| `src/modules/ai/assistant/model.ts` | 内部、通用、联网各自的提示词与输出校验 |
| `src/modules/ai/assistant/services.ts`、`types.ts`、`http.ts` | 事务审计、来源持久化、严格输入、HTTP 428 |
| `src/components/assistant/assistant-workspace.tsx`、`external-search-dialog.tsx` | 模式切换、安全提示、确认弹窗、流式回答与来源 |
| `src/components/layout/navigation.ts`、`app-sidebar.tsx` | 智能助手导航名称与图标 |
| `prisma/schema.prisma`、`prisma/migrations/20261028000000_assistant_modes/` | 增量字段、幂等迁移与保护性回滚 |
| `src/modules/ai/assistant/modes.test.ts`、`tests/integration/rag-assistant.test.ts`、`e2e/assistant-modes.spec.ts` | 单元、真实数据库、浏览器安全边界验证 |
| `.env.example`、`tests/fixtures/ai-stream-server.mjs`、`scripts/test-ai-streaming-e2e.mjs` | 服务端搜索配置与隔离协议测试 |
