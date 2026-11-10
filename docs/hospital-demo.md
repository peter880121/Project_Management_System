# 医院 EMR 全流程演示环境

运行 `node scripts/prepare-hospital-demo.mjs` 只预览，不写数据库或配置。

### 三项目全流程测试基线

`node scripts/prepare-hospital-demo.mjs --apply --with-standard-projects` 保留医院 EMR 演示，并通过现有创建项目服务新增“XX市人民医院检验系统建设项目”和“中医院电子病历建设项目”的干净规划基线。共 3 个项目、42 个任务：EMR 为 6 已完成 / 1 进行中 / 7 待办，另外两个项目各 14 个待办、待人员配置和排期。四个角色账号密码保持原值，所有任务使用严格签名证据模式 2。

全部项目、任务和文档使用独立 UUID，避免共用 MinIO/Milvus 时混入旧环境资产。旧库与原审计完整保留，最新环境清单为 `output/environment/current.json`，环境备份位于项目根目录 `.env.before-demo-*`。

清理仅删除 `.next`、`test-results` 等生成产物；测试源码、合成 PDF、环境备份与旧库不删除。服务由操作者手动启动：

```powershell
# 分别在三个终端运行；MySQL、MinIO、Milvus 需事先可访问
pnpm dev
pnpm documents:worker
pnpm risks:worker
```

启动后可运行 `node scripts/verify-hospital-demo.mjs --with-standard-projects`，检查账号、下载与七个页面。默认不截图；只有显式设置 `E2E_CAPTURE_EVIDENCE=1` 才采集截图。验证摘要输出至 `output/environment/verification.json`。

```powershell
# 创建全新演示快照，校验通过后切换本地 .env
node scripts/prepare-hospital-demo.mjs --apply
# 重启本地开发服务，确保 Prisma 连接指向新库
pnpm dev
# 只读业务冒烟：账号登录、下载校验和六个页面检查
node scripts/verify-hospital-demo.mjs
```

前置条件：本机 MySQL、现有数据库账号及 MYSQL_ROOT_PASSWORD、四个基础账号；已配置且可访问的 MinIO、Embedding API 和 Milvus。脚本拒绝 production、远程 MySQL 及非 medpm 开发库，数据库与账号标识严格校验。生产业务逻辑不受影响，无 Schema 迁移或新增运行依赖。

## 安全清理

脚本不会 TRUNCATE、DELETE、关闭外键或停用审计触发器。它新建唯一的 `medpm_demo_hospital_*` 库，用现有 Prisma migration 建表，只导入四个基础账号及必要的禁用系统审计主体。四个账号的 ID、邮箱及密码哈希保留，登录失败计数、会话和测试账号不会带入；角色和 ACTIVE 状态作为演示授权明确审计。

执行前备份 `.env.before-demo-medpm_demo_hospital_*`；执行中全部 MySQL 业务写入位于事务。文件使用项目 UUID 的独立 MinIO 前缀；上传后重新读取并核对 SHA256。任何失败都保留原库与对象，验证通过才原子替换 `.env`。并发修改 `.env` 或原库审计时拒绝切换。失败的暂存库保留供排查，绝不自动删除审计。

每次执行创建新快照，重复执行后的有效演示数据始终为一套，不会向当前项目追加重复任务，也不会重置已经演示过的签名记录。需要撤销切换时，停止开发服务，将该次 `.env` 备份恢复为 `.env` 并重新启动服务；不需要删除任何数据库。

## 预置内容

项目：**XX市第一人民医院EMR系统交付**，ACTIVE，负责人为 `pm@medpm.local`。

| 数据 | 内容 |
| --- | --- |
| 基础账号 | admin、pm、qa、member，邮箱均为对应名称加 `@medpm.local`，密码保持原值 |
| 标准 WBS | 复用项目模板的 6 个阶段、14 个任务，6 DONE / 1 IN_PROGRESS / 7 TODO |
| 排期 | 相对运行日期生成工作日排期，13 条顺序依赖，全部分配负责人并关联需求 |
| 已批准交付物 | 《项目实施主计划》《需求规格说明书》《EMR实施蓝图》，真实中文 PDF、独立 V1、SHA256、PM 提交与独立 QA 评审证据 |
| 签名 | 6 个已完成任务均有匹配当前 completedAt 的签名意图及审计，均明确标记为合成历史预置，未冒充操作者实时输入密码签署 |
| 会议 | 一份已定稿周例会，3 条待处理行动项，含建议负责人、日期，可现场人工转任务 |
| 追溯 | 3 条已批准需求、3 个待执行测试用例；NOT_RUN 是待开展验证，不伪造测试通过 |
| AI 索引 | 从自有合成文档源导入已核对文本，provider=`synthetic-authored-source`；现有 Worker 切块并通过真实 Embedding API / Milvus 入库，不伪装为 MinerU 云端解析或使用假向量 |

默认必须完成真实索引才能切换。离线准备可加 `--skip-index`，保留 PENDING 分块等待真实 Worker；前端会显示同步中，不标为已入库。`--no-switch` 可仅准备暂存快照，不改变 `.env`。

本项目处于执行中：8 个任务未完成，5 个后续任务仍待交付物，3 个行动项未转任务。这些是用于演示整改流程的真实待办，初始体检不会通过；已完成任务不缺签名或所需批准文件。完整演示不应把这些正常待办当成系统报错。

## 建议演示顺序

1. PM 登录，展示分阶段折叠看板和甘特图排期。
2. 查看已完成任务的交付物，下载 PDF，展示只读哈希、QA 证据及 AI 已入库状态。
3. 打开会议，人工确认一条行动项并转为任务，观察看板与排期刷新。
4. 用当前 SIT 任务展示“需交付物”前置拦截；新建独立版本演示 PM 提交、QA 审批、密码二次确认。
5. 运行 AI 结项体检，展示当前未完成事项及整改跳转。风险提交权限由 ADMIN 在成员页现场明确授予；最终 QA/归档规则仍保留。
6. 需要复位时重新运行安全准备脚本，重启服务并重新登录。

## 验证与文件

生成清单及环境备份名记录在 `test-results/hospital-demo/medpm_demo_hospital_*.json`；只读冒烟结果为 `verification.json`，截图为 `board.png`、`deliverables.png`、`meetings.png`。验证写入的只有正常登录/登出及下载审计，不增删改业务数据。

新增文件：准备脚本、只读验证脚本、`scripts/lib/load-typescript.mjs`、合成文档源 `prisma/demo-assets/hospital/documents.json`、PDF 生成工具 `scripts/generate-hospital-pdfs.py` 和 `output/pdf/hospital/` 下的三份 PDF。重新运行准备脚本只读取已生成 PDF，不需要安装 Python 工具。

PDF 重制工具仅用于作者工作流，依赖 reportlab、pypdf、PyMuPDF，未加入应用依赖。重制后应重新检查页面并生成新的演示快照；不可覆盖已经批准版本对应的 MinIO 文件。

本次准备结果：lint、typecheck、505 项单测通过；四个账号真实登录、六个页面、三份 PDF 的 HTTP 下载及 SHA256 校验通过，页面异常及失败请求为 0。三份文档共 3 个分块真实入库，SyncFailure 为 0。另已验证重复准备会生成同样数量的独立快照，不向原项目追加数据。

本机开发服务需具备现有局域网 MinIO/Milvus 和 AI 接口的网络访问权限。使用受限沙箱启动服务可能导致真实下载返回 503；本次最终服务已在具备所需网络权限的环境运行。重新启动服务时应使用正常本地终端。
