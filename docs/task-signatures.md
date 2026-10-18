# 任务完成电子签名

任务卡片和详情抽屉的“完成”都打开电子签名弹窗。弹窗展示任务名与目标状态，收集实际工时、当前用户密码和签名意图。签名意图由 `src/modules/tasks/signature.ts` 统一定义，前后端共用 `z.enum`，覆盖任务完成、会议完成、计划编制、需求与方案评审、配置与联调、开发完成、测试通过、数据迁移、培训、发布上线、验收与移交。

默认选项为“确认任务已完成”，操作者按实际事项选择具体意图。例如“召开项目启动会”可以选择“确认会议已完成”。原有开发、测试与发布意图仍保留，历史签名与审计记录不变；未开放任意文本意图。

签名意图扩展验证（2026-10-18）：lint、typecheck、448 项单测通过；独立测试库中的 2 项签名 E2E 通过，确认会议完成意图可提交并原样写入签名审计，同时保留错误密码 401、非法意图拦截与刷新失败提示验证。

`PATCH /api/tasks/[taskId]` 的 DONE 请求必须携带 `actualHours`、`signaturePassword`、`signatureReason`。其他状态与分配接口维持原规则。服务层再次校验签名，避免绕过 HTTP 入口；在现有 Prisma 事务中锁定并验证操作者权限，仅查询 `passwordHash`，通过 bcrypt 比对后更新任务并写入 `TASK_SIGNED_AND_COMPLETED`。审计记录保存 before、after（包含 signatureReason）、actorId、projectId、ip、userAgent 和 UTC 时间。无需新增依赖、数据库字段或迁移。

密码错误返回 401，输出不含密码或哈希的安全事件；没有密码哈希的账号也无法签署。审计失败回滚整个操作。P2028 返回 503 和“系统繁忙，请重试”，不会向客户端暴露数据库异常。事务仍采用默认超时；bcrypt cost 12 会占用事务时间，高并发下可能需要重试。

前端提交期间禁止重复确认、取消和 Escape 关闭。密码仅在弹窗临时状态中保存，提交结束与关闭时清空；不持久化、不记录请求体。签署成功即在页面本地更新完成状态，随后刷新列表/抽屉；刷新失败仍关闭签名窗，并提示“签署已成功，但数据刷新失败，请手动刷新”。签名测试关闭网络 trace，防止测试产物保存凭据。

验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`；`pnpm exec vitest run --config vitest.integration.config.ts`；`pnpm test:e2e`。集成测试会启动自己的 Next.js 服务，必须与 Playwright 页面测试串行执行，避免共用 `.next` 构建缓存。

新增真实 MySQL 测试覆盖错误密码不写入、审计失败回滚、并发完成仅成功一次及服务层权限复核。浏览器测试覆盖卡片、抽屉、取消、密码显示切换、非法意图、401 Toast、成功 Toast 和刷新失败提示。验收截图位于 `test-results/signature-evidence/`，仅使用合成数据。

本功能提供密码二次认证和签名意图审计；不代表已完成 GxP 或 21 CFR Part 11 的全系统验证。

## 本次文件清单

- `src/modules/tasks/signature.ts`、`signature.test.ts`：共享签名意图和校验。
- `src/components/tasks/electronic-signature-modal.tsx`：签名弹窗。
- `src/components/tasks/task-card.tsx`、`task-detail-drawer.tsx`、`board-types.ts`：完成入口和签名类型。
- `src/app/projects/[projectId]/board/task-board.tsx`：提交、Toast 与刷新降级。
- `src/app/api/tasks/[taskId]/route.ts`：DONE 请求校验。
- `src/modules/audit/service.ts`：事务内复核和签名审计。
- `src/modules/audit/errors.ts`、`errors.test.ts`：P2028 安全响应。
- `tests/integration/task-signature.test.ts`、`project-access-exports.test.ts`：真实数据库签名和权限验证。
- `e2e/task-signature.spec.ts`、`board-layout.spec.ts`：签名交互与原看板用例适配。
- `tsconfig.json`：排除生成的测试报告和构建验证副本，保留正式源码的类型检查。
- `docs/task-signatures.md`：接口、设计取舍和验收说明。

## 2026-10-18 验证记录

- lint、typecheck、diff 空白检查通过；Vitest 单元测试 416 项通过。
- 全量集成测试 117 项通过、2 项按配置跳过。
- 全量 Playwright 93 项均已执行：首次 87 项通过、4 项按配置跳过，文档上传和合规导出两项因沙箱访问 MinIO 返回 EACCES 失败。停止旧服务后，在沙箱外新启动的测试服务中补跑这两项及签名两项，4 项全部通过；综合为 89 项通过、4 项跳过。
- 签名截图：`test-results/signature-evidence/01-signature-modal.png`、`02-signature-401-toast.png`、`03-signature-success-toast.png`；401 响应另存 `401-response.json`，不含请求密码。`04-signed-refresh-failed.png` 记录保存成功但刷新失败的提示。
