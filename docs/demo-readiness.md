# 演示前自检与清理记录（2026-10-18）

## 当前演示环境

- 入口：http://localhost:4000，已运行的开发服务已确认切换到新库。
- 当前数据库：`medpm_demo_20261018_267ea2`；3 个内置项目、24 个任务、7 个账号（4 个正常角色、待激活/已禁用账号及系统身份）、3 条待确认 WBS 建议。
- 项目：Atlas Release Readiness、Beacon Validation Upgrade、Cedar Security Hardening。基于内置合成基线准备，原库的历史进度仍保存在原库。
- ADMIN / PM / MEMBER / QA 登录、项目列表和 Atlas 看板均验证成功；账号沿用原密码。检查产生的临时登录均已退出，当前无检查遗留的活动 Session。
- 管理员健康检查 HTTP 200：MySQL、Milvus、MinIO 均为 ok。模型及 MinerU 凭据已配置，本次没有再次发起付费生成或云端解析。

数据库切换后请重新登录；旧页面中的验收项目链接不属于当前演示库。内置的 LEGACY 文档是占位记录，不能替代真实上传的合成 PDF；演示上传/解析/RAG 时请使用自己的合成材料并按需启动文档 worker。默认没有自动运行风险 worker，风险自动扫描需 PM 显式启用。

## 清理及修复

- 清除旧日志、失败 trace、历史测试报告、构建验证副本等 1,306 个文件，释放约 1,027 MB。
- 删除误保存的 Vim 文件 `wq`。
- 保留 `test-results/ai-streaming-evidence/`、`test-results/signature-evidence/` 的验收截图；正式单测、E2E、协议 fixture 及业务代码保留。
- `.dockerignore` 排除测试代码、测试 runner、报告、日志、构建副本、演示管理脚本及本地依赖缓存，避免混入应用镜像。
- 修复内置 seed WBS 建议仍使用旧 proposal 结构的问题：改为当前可展示/采纳的任务建议结构，保持 PENDING，不直接创建正式任务。只修复来源为 synthetic-seed、尚未审核的旧样例；修复与 `SEED_SUGGESTION_MIGRATED` 审计同事务提交。
- Playwright 与数据库集成测试增加演示库保护：检测到 `medpm_demo_*` 立即拒绝执行，避免再次向演示库写入验收夹具。单元测试可继续直接运行。

## 原库与恢复

原库 `medpm` 的 273 个项目、659 个账号、1,922 条审计全部保留，没有删除审计、关闭触发器或清理其 MinIO/Milvus 关联证据。

切换前的本地环境备份为 `.env.before-demo-medpm_demo_20261018_267ea2`，受 `.env.*` 忽略规则保护，包含私密配置，不应提交或共享。若需恢复，取其中的旧 `DATABASE_URL` 更新当前 `.env`，重启服务并重新登录；无需覆盖其他新配置。旧库没有被用作本轮清理后的写库测试目标。

`node scripts/prepare-demo-database.mjs --apply` 可在本地创建另一套干净演示库：校验本地 MySQL、备份环境、应用现有迁移、初始化内置样例、保留角色账号密码，验证后再切换 `.env`。脚本不删除源库；需要本地 MySQL 管理员权限，禁止用于 production。没有新增数据库迁移。

## 验证边界

- lint、typecheck、437 项单元测试通过；脚本语法检查和 Docker Compose 配置解析通过。
- 四个正常角色的真实 API 登录/退出、3 项目可见性及看板读取通过；WBS GET 确认建议标题、工时和依赖结构有效。
- 演示库保护使用只读的测试收集命令验证，未运行会创建项目的 E2E 或数据库集成测试。
- 上次全量 E2E 为 89 通过、8 按配置跳过，4 项流式专项另行通过；本次不将旧成绩记作重新执行。

本次修改：`.dockerignore`、`prisma/seed.mjs`、`playwright.config.ts`、`vitest.integration.config.ts`、`scripts/prepare-demo-database.mjs`、`README.md`、本记录，以及 Vim 误存文件删除。本地 `.env` 仅修改数据库连接，未提交秘密。
