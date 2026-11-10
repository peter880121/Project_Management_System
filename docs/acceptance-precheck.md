# AI 结项前置审查

数据库规则决定能否送审，AI 只解释缺口。一次体检不会修改任务、签名、交付物或项目状态。

## 规则与证据

统一入口为 `src/modules/projects/acceptance-check/service.ts`，体检、正式提交、QA 审查和 ADMIN 归档复用同一组规则：

| 规则 | 判定 |
| --- | --- |
| 未完成任务 | Task.status 非 DONE |
| 缺少交付物 | requiresDeliverable=true，但没有同项目、同任务的 APPROVED 交付物及 AVAILABLE、具有有效 SHA256 的 Document |
| 缺少签名 | DONE 任务缺少同项目、同任务的 TASK_SIGNED_AND_COMPLETED 审计；after.status、signatureReason 和 completedAt 必须匹配当前完成轮次 |
| 未转任务行动项 | MeetingRecord.actionItems 没有关联本项目中真实存在的 Task；打勾不等于已转任务，跨项目或悬空 TaskId 无效 |
| 空项目保护 | 无任务的项目不能提交验收，也不能特权提交 |

行动项统计采用 MySQL 8 `JSON_TABLE`，不把所有会议 JSON 拉到 Node，也不通过时间截断遗漏历史行动项。明细按项目过滤，每页 20 条；受限会议只显示脱敏提示。原生 SQL 全部参数化。

“合规缺口总数”是规则违规项之和，同一任务可能同时缺少交付物和签名，不等于有问题的任务数量。

证据指纹按主键游标每页 200 条增量计算 SHA256，避免 GROUP_CONCAT 截断和全表内存加载。指纹包含任务、交付物、文档证据、会议版本和签名审计；不包含解析 Worker 的运行状态，避免后台索引造成无关失效。

## HTTP 与 SSE

`POST /api/projects/:projectId/acceptance-check`：仅 ACTIVE 项目的 PM/ADMIN 可调用，需要项目访问权。请求体为 `{}`，同源请求；沿用现有 generation ID 和取消协议。

- 规则通过：直接返回 `{"passed":true,"message":"合规检查通过，可提交验收"}`，响应头 `X-Check-Id`、`X-Evidence-Fingerprint` 提供后续提交凭据；不调用 LLM。
- 存在缺口：先事务写入不可改写的 ProjectComplianceCheck 和 PROJECT_COMPLIANCE_CHECKED 审计，再通过 SSE 发送 `progress`、`delta`、`result`、`error` 等现有事件。
- HTTP 鉴权/业务错误在建立流之前返回；流内权限撤销使用 `UNAUTHORIZED`，证据变化沿用 `SOURCE_CHANGED`，HTTP 提交失效使用 `CHECK_STALE`。
- `GET` 同路径支持 `checkId`、`rule`、`page`；重新核验权限与证据后返回已有结果及分页明细，不重复调用模型。

模型仅接收规则类别与计数，不发送会议正文、任务标题或人员信息。提示词禁止编造缺口、正向合规结论和自行输出数量；结构化建议必须恰好覆盖数据库确认的规则。最终标题与数量由服务端渲染。预览跨分片过滤正向结论和数字，沿用控制标签清洗器。

结构校验最多纠正两次，发送 retrying 进度。模型不可用或越过事实边界时降级为固定整改指引，保留真实缺口且 passed=false。AI 建议以 ACCEPTANCE_DIAGNOSIS/PENDING 保存，不改变业务状态。

关闭抽屉、停止生成会取消 reader、打字机队列及 LangChain 请求。已完成的规则审计保留，未完成的 AI 结果不落库。保存前在事务中再次核验权限、项目版本和证据指纹。

## 正常提交、失效与风险送审

正式提交始终重新查库；前端传来的 passed、数量、权限均不可信。有 checkId 时，还必须属于当前操作者和项目，并匹配规则版本、项目版本、证据指纹及计数。数据变化返回 409/CHECK_STALE，前端清除缓存并弹出“体检结果已失效（因为数据被修改），请重新体检。”

仅 ADMIN 或由 ADMIN 明确授予项目级 canOverrideAcceptance 权限的活跃 PM 可特权提交。授权和撤销均审计，成员移除/重新加入不会恢复旧授权。特权提交必须提供当前失败体检、至少 20 字风险说明和人工确认；空项目及损坏的已批准证据不能绕过。

送审事务保存 overrideReason、overrideGapCount、overrideCheckId，写入 PROJECT_ACCEPTANCE_OVERRIDE_SUBMITTED 和 PROJECT_SUBMITTED。看板及验收页持续显示“⚠️ 带风险待审（存在 X 个合规缺口）”。

特权只允许送交风险审查，不豁免 QA 或归档规则。存在缺口时 QA/ADMIN 仍拒绝通过；须撤回或驳回、整改、重新体检并重新提交。定稿会议可人工追加行动项 TaskId 关联，保留原正文和行动项内容，并在转任务事务中审计。

## 迁移与兼容

迁移：`prisma/migrations/20261022000000_acceptance_precheck/`。

- 新增 ProjectComplianceCheck、特权字段、成员授权字段和签名审计查询索引；历史授权默认 false、风险数量默认 0。
- 检查记录、验收风险字段由数据库触发器禁止改写。检查记录是附加审计证据，不属于可编辑业务数据。
- 新验收快照使用 version=2，包含统一规则证据指纹；既有 version=1 快照保持原哈希算法和数据，审批时仍运行当前硬规则。
- migration.sql 可重放；down.sql 在已有检查、授权、风险送审或相关 AI 结果时拒绝回滚，防止删除证据。上线后优先前向修复。

## 验证与演示证据

使用 `node scripts/test-project-ia.mjs` 在独立合成数据库运行真实 MySQL 集成测试、浏览器回归和 LangChain 流式协议测试，保持演示库与审计历史不变。流式模型使用确定性协议夹具，验证真实 reader、SSE、取消和事务边界；不等价于对外部模型供应商的可用性承诺。

新增覆盖：当前轮次签名、历史会议 JSON_TABLE 分页与 HTTP 序列化、跨项目/角色/跨站拒绝、请求 ID 碰撞、审计失败回滚、授权撤销、特权审查边界、空项目、定稿行动项整改、体检过期、流式取消、防幻觉降级及权限中途撤销。

截图由浏览器测试生成：`test-results/acceptance-check-evidence/`，包含流式诊断、风险说明、带风险待审看板和过期提示；均使用合成数据。

## 修改范围

| 层 | 文件与目录 |
| --- | --- |
| 模型、迁移 | `prisma/schema.prisma`、`prisma/migrations/20261022000000_acceptance_precheck/` |
| 规则与审批 | `src/modules/projects/acceptance-check/`、`acceptance.ts`、`members.ts`、`capabilities.ts`、`http.ts`、`freeze-manifest.ts` |
| AI、审计与行动项 | `src/modules/ai/acceptance-check/`、`src/modules/audit/service.ts`、`src/modules/tasks/meeting-source.ts` |
| API | `src/app/api/projects/[projectId]/acceptance-check/route.ts`、`lifecycle/route.ts` |
| 页面与组件 | 项目 layout、board、members；`src/components/projects/acceptance-*.tsx`、`capabilities-context.tsx`、`src/components/assets/meetings-manager.tsx` |
| 验证 | `tests/integration/acceptance-check.test.ts`、`project-closure.test.ts`、`e2e/acceptance-check-streaming.spec.ts`、规则单测；流式测试夹具和隔离测试启动脚本 |

本次未引入依赖，不修改 MinIO/Milvus Schema。

本次回归结果：lint、typecheck 通过；505 项单测通过；181 项真实数据库集成测试通过、2 项可选外部服务测试跳过；常规 E2E 103 项加流式 E2E 18 项通过，4 项既有 Worker 依赖用例跳过。流式用例在常规回归中先跳过，再由独立模型夹具完整运行，未重复计入通过数。

本地迁移完成，5 个项目、57 个任务、115 条审计及其他原有数据保持不变。业务字段、成员关系和审计指纹已进行迁移前后比对；测试数据仅写入隔离库。重复迁移与拒绝破坏性回滚的证据保存在截图目录中的 JSON 文件。
