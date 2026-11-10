# 测试环境清理

正式测试保留：`tests/`、`e2e/`、`src/**/*.test.ts`、Vitest/Playwright 配置和测试启动脚本。清理不改动业务代码、账号、审计规则或数据库迁移。

## 提交前文件清理（2026-11-10）

- 从工作目录移除 531 个文件（约 12.8 MiB）：`test-results/`、`debug.log`、TypeScript 构建缓存、`output/half-year-simulation/`、`output/audit-remediation/` 及与本项目无关的 `.qqbot-tools/`。
- 删除前已归档到 `.maintenance/file-cleanup-20261110-150913-186/generated-artifacts.zip`；同目录 `manifest.json` 记录原路径、文件数、大小与 SHA256。归档仅保留本地，不进入 Git 或 Docker 构建上下文。
- `.gitignore` 和 `.dockerignore` 排除以上生成目录、本地环境清单及维护归档。`.env` 和 `.env.*` 继续忽略，`.env.example` 保留。
- 正式测试、测试 fixture、数据库迁移、合成数据源 `prisma/demo-assets/`、演示 PDF、实施计划及测试执行台账保留。这些文件支持回归测试和演示复现。
- 历史文档中 `output/half-year-simulation/` 与 `output/audit-remediation/` 的证据路径对应本地归档内容，不作为仓库随附文件；需要时可从归档恢复或重新生成。
- 未连接或清理 MySQL、MinIO、Milvus，未修改业务数据与审计记录。
- 归档校验通过（531 个文件，SHA256 一致）；清理后 lint、类型检查及 96 个测试文件中的 666 项单元测试全部通过。验证重新生成的构建缓存随后再次归档清理。未运行会生成测试库的集成/E2E 测试。

清理脚本默认预览；可用 `-AdditionalTargets .qqbot-tools` 指定额外的本地工具目录，所有目标仍经过工作区边界与重解析点检查。

## 历史清理（2026-10-21）

- 移除 74 个生成文件：`test-results/`、旧日志、TypeScript 构建缓存、`output/weekly-reports/`、临时部署脚本、旧 schema/DDL 副本和迁移验证输出。
- 完整生成物归档：`.maintenance/file-cleanup-20261021-174423-534/generated-artifacts.zip`。同目录 `manifest.json` 保存原相对路径、数量及压缩包 SHA256。
- 清理 217 个闲置 `medpm_test_ia_*` 隔离测试库，MySQL 估算空间约 504 MiB。
- SQL 归档：`.maintenance/database-cleanup-20261021T094110272Z/isolated-test-databases.sql.gz`，约 6 MiB，包含数据、触发器和存储过程。
- 数据库清单与解压后 SHA256：`.maintenance/database-cleanup-20261021T095147730Z/manifest.json`。实际恢复最后一个测试库，核对 49 张表及 46 条审计后，才执行清理；另移除三个工具自身产生的恢复校验临时库。
- MySQL 8.0.26 导出的部分触发器含多余结尾分号，恢复校验会规范化可执行 DDL 注释外层的结尾分号，不修改数据或触发器内部语句。恢复完整归档时同样需要该兼容处理。

保留当前演示库、4 个项目、65 个任务、5 个账号、936 条审计和 1 份周报。本次没有重置你手动演示的业务进度，没有修改 MinIO 或 Milvus，也没有启停应用或 Worker。

保留 `output/environment/` 环境清单、演示 PDF、项目实施计划和测试执行台账；这些文件被现有脚本与说明引用，不能当垃圾删除。

## 重复使用

```powershell
# 默认只预览，不清理
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/clean-test-artifacts.ps1
node scripts/archive-test-databases.mjs

# 明确执行；文件先归档，数据库先完整导出并恢复校验
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/clean-test-artifacts.ps1 -Apply
node scripts/archive-test-databases.mjs --apply
```

PowerShell 执行策略仅对该进程生效，不改系统策略。文件清理限定工作区内的显式目标，拒绝符号链接/重解析点。数据库清理限定本地非生产环境及严格匹配的测试库名，跳过仍有连接的库，拒绝当前业务库；归档/恢复校验失败时不删除原库。

`.maintenance/` 已忽略提交，包含可恢复证据和可能敏感的合成账号哈希，请勿公开发布。不要在没有其他备份时删除该归档。需要回收操作系统磁盘空间时，以 MySQL 表空间及文件系统的实际回收结果为准，504 MiB 是清理前的数据库估算占用。

清理后验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`，627 个单测通过；没有重跑会重新生成测试库的集成/E2E。新的验证日志只放在 `.maintenance/`。
