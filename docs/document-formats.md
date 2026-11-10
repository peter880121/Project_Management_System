# 多格式交付物与文档解析

项目文档和交付物共用格式校验、上传、存储及下载链路。支持 PDF、DOCX、TXT、TEXT、MD；复用现有 Document、DocumentParseJob、DocumentChunk、Deliverable 和 SyncFailure，不新增数据库字段或迁移。

| 类型 | 上限 | 解析器 | 来源位置 |
| --- | --- | --- | --- |
| PDF | 20 MB | 原 MinerU 云端异步流程 | 已有真实页码，缺失时不推测 |
| DOCX | 20 MB | 本地段落、Heading1–6、表格行文本提取 | 段落/结构块及字符范围，page=null |
| TXT / TEXT / MD | 5 MB | 本地严格 Unicode 解码 | 结构块及字符范围，page=null |

## 文件与内容校验

`formats.ts` 是浏览器与服务端共享的格式白名单和大小限制。后端同时检查文件名、声明 MIME、实际内容及实际请求长度。允许浏览器缺少 MIME 或给出通用二进制 MIME，但必须通过内容验证，并保存规范 MIME。

纯文本接受 UTF-8（可含 BOM）、带 BOM 的 UTF-16 LE/BE；无 BOM 的其他编码不猜测，提示转换为 UTF-8。禁止空白文件、无效编码、二进制控制字符、伪装 PDF/ZIP/RTF。MD 按原始文本预览，不执行 HTML，不加载外部图片。原始字节不改写，SHA256 按原件计算。

DOCX 复用 `fflate`，将依赖树已有的 [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) 5.11.2 声明为直接依赖。XML 禁止 DTD/实体声明、关闭实体展开；只解码内建和数值字符引用。ZIP 最多 512 条目、总展开大小最多 40 MB，单个待解析 XML 最多 8 MB，限制深度和节点数量；拒绝重复/越界路径、宏、嵌入对象和外部文档/图片关系。普通超链接只取文字，不访问目标。

DOCX 本次只提取正文文字，不复刻 Word 排版，不对嵌入图片进行 OCR；扫描图片型或无文字 DOCX 提示无法提取内容。旧 DOC、DOCM 不在白名单。新增本地解析输出上限为 200 万字符、20000 个结构块。

## 存储、审批与解析

上传接口保持现有 multipart 字段和幂等 uploadKey；对象 key 保留实际扩展名，MinIO 写入正确 Content-Type。下载按存储元数据设置 Content-Type，保留原名与扩展名、attachment、nosniff、原件 SHA256 核验及导出审计。失败对象清理仍严格核对项目/文档专属路径。

交付版本只有 APPROVED 才能解析和索引。正在解析的独立文档不能中途绑定为交付草稿；此前解析成功的文档绑定草稿后，也被分块、向量候选和检索查询排除，审批通过后才恢复流水线。PM 提交、QA/ADMIN 独立审批、禁止自审和冻结规则保持不变。

PDF 仍须明确云端处理确认。DOCX/TXT/TEXT/MD 不要求确认发往 MinerU；界面明确本地提取后仍由配置的向量模型生成 Embedding，并不是所有 AI 数据处理都留在本机。

本地任务写入 provider=`local-document-v1`、phase=`LOCAL`，由同一个文档 Worker 消费；成功后同事务发布规范文本、结构块、结果哈希和审计，再走原有 Chunking / Embedding / Milvus。原文件大小与哈希会在解析前重新检查。解析失败不覆盖旧成功版本，不改变原件存储状态；索引失败继续通过 SyncFailure 重试。PDF 历史任务保持原 provider、phase 和版本，不需要回填。

## 受影响文件

- `src/modules/documents/{formats,validation,text-decoding,docx,local-parser}.ts`：格式规则、解码、DOCX 提取。
- `src/modules/documents/{services,storage,repositories}.ts`：多格式上传、MIME、下载及列表状态。
- `src/modules/documents/{parse-service,parse-worker,rag-repositories,rag-worker}.ts`：分派任务、本地发布、审批前索引拦截。
- `src/modules/assets/{services,validation}.ts`：交付物绑定、条件云端确认及审批后分派。
- 交付物 operation Route、文档下载 Route：解析确认与响应类型。
- 项目文档上传、解析、引用详情及交付物面板：文件选择、类型提示、本地预览与状态展示。
- 新增格式单测、真实 MySQL 流水线测试、浏览器专项及独立本地 Worker 测试入口。

测试均使用隔离数据库和合成对象存储，未重置当前演示数据。默认不额外截图；变更生效后需重启仍运行旧代码的文档 Worker。本次不替操作者启动或停止已有服务。

## 验证记录

- `pnpm lint`、`pnpm typecheck` 通过；全量单测 85 个文件、548 条通过。
- 相关真实 MySQL 集成 46 条通过，1 条真实供应商用例跳过。覆盖新增格式完整业务流水线、原 PDF 解析与存储、审批权限、审计失败回滚、损坏原件、失败对象清理、向量失败重试及检索降级。向量写入使用注入适配器断言真实业务元数据，不宣称调用了真实模型供应商或 Milvus。
- 相关 E2E 合计 10 条通过：新增多格式 6 条、原 PDF 上传/下载 1 条、交付物版本/权限/会议回归 3 条。浏览器上传经过真实 MinIO SDK 和独立 S3 协议夹具；本地解析经过实际 Worker 处理器及 MySQL。
- 新格式专项无截图。原 PDF 交付物专项改为显式 `E2E_CAPTURE_EVIDENCE=1` 才采集截图。
- DOCX 审批测试先修正了按钮名称，随后改为两个独立浏览器会话模拟 PM 与 QA，专项完整复测通过；未调整审批权限或降低业务断言。
