# PMO 数据决策中心

入口 `/dashboard`，API `GET /api/dashboard/stats`。采用 Tailwind、原生 SVG、已有图标，不增加图表依赖。已登录首页保留，ADMIN / PM 增加入口，PMO 登录后首页转到 Dashboard。

## 权限与过滤

ADMIN、PMO 聚合全局数据；PM 聚合本人负责或有效参与的项目；QA、MEMBER 返回 403。PMO 仅新增独立统计权限，未加入项目写入、文档访问、审批或用户管理权限。账号管理允许 ADMIN 创建/调整 PMO 角色，变更沿用原事务审计；PMO 可以读取自己的会话和维护个人密码。

参数为可选 UUID `projectId`、`healthPage`、`loadPage`，分页固定 20，页码 1–10000。未知参数、重复参数和非法值返回 400。角色拒绝先于参数解析。所有 Prisma 查询和签名原生 SQL 都使用相同的权限交集：可见范围 AND 指定项目；PM 传入外部项目 ID 返回 200 和全零/空结果，不透露项目是否存在。

每次统计在短只读 RepeatableRead 事务内重新查询账号状态和角色；统一统计时间和数据库快照，不锁定项目行，不调用 AI 或后台 Worker。响应 `private, no-store` 且 `Vary: Cookie`。前端使用 AbortController 和请求序号隔离旧响应，刷新/过滤时先清除旧结果，401/403 不保留历史统计。

## 查询与业务口径

| 模块 | 口径及实现 |
| --- | --- |
| 进行中、归档项目 | Project 按 status groupBy，ACTIVE / ARCHIVED；历史 COMPLETED 不算归档 |
| 逾期任务 | 规划、进行中、暂停项目中，未 DONE 且 dueDate 小于统计时间；Task.count |
| 签名证据缺口 | 当前 DONE 任务缺少同项目、同任务、本次 completedAt、合法签名意图的完成签名审计 |
| 人员任务量 | Task 按 assigneeId groupBy、COUNT 排序分页；仅批量取当前 20 人姓名及角色；未分配另 count |
| 项目健康度 | ACTIVE 项目分页取 ID、名称，再按 projectId/status 聚合任务、按 projectId 聚合逾期和近 7 天 PENDING 的 RISK 建议 |
| 月度交付 | 最近 6 个香港自然月，各两次 count，统计 archivedAt 与 Deliverable.createdAt；交付物每个新版本算一次 |

Task 与 AuditLog 没有直接外键，签名缺口使用参数化 COUNT + NOT EXISTS，全部在 MySQL 中完成反关联。completedAt 比较保留 DATETIME(3) 毫秒，过去一次签名不能满足重新完成后的证据要求；无 completedAt 也会被识别为缺口。这个指标不等同于全部合规断链或法律合规结论。

完成率只对数据库返回的有界分组计数计算 DONE / 总数；无任务显示“尚未建立计划”。风险指标是“近 7 天待处理风险建议数”，不是独立风险事件数。资源图是“未完成任务量”，不使用未经容量验证的超载阈值。所有展示按客观数据呈现，不生成综合健康分。

禁止拉取完整 Task、AuditLog、Deliverable 明细在 JS 统计。项目和人员仅有界分页读取展示字段；趋势固定 12 次计数，健康度固定批量分组，不随人数/项目逐个请求。事务内 Promise.all 只是组织查询，单连接不会并行执行 SQL。

## 时区与图表

存储 UTC，按香港 UTC+8 计算自然月起止，再用 `[start, end)` 查询；不依赖主机时区，也不对数据库时间列套日期函数。空月份补零。单元测试逐一覆盖 12 个月的月末 23:59:59.000、23:59:59.999，以及次月 00:00:00.000、00:00:00.001，另外覆盖跨年、闰年及 UTC 日期仍在上月的边界。真实数据库测试同时验证项目归档及交付物两个日期字段。

柱状图使用青绿 SVG 渐变；趋势使用青绿、天蓝双折线及淡渐变面积。柱和节点均包含原生 title 提示，趋势另提供可访问的数据表。先计算 value / max 再乘坐标，避免大数乘法溢出；最大值至少为 1，全零保持基线，非法数值不进入坐标。SVG 使用 viewBox 和裁剪容器，移动端自动缩放。

## 模型与迁移

迁移 `prisma/migrations/20261020000000_pmo_dashboard/`：

- User.role 追加 PMO，不修改历史账号角色；没有新增业务表或改写历史证据。
- 增加 Project(status, archivedAt)、AiSuggestion(projectId, type, status, createdAt)、Deliverable(createdAt) 索引；复用现有项目、成员、负责人、任务状态/截止日期及审计实体索引。
- 索引通过 information_schema 存在性检查创建；生产仍通过 Prisma migration history 管理。
- down.sql 撤回可选统计索引，保留 PMO 枚举和账号，不把现有身份自动改成其他角色。完整角色降级必须先明确处理 PMO 账号并保留权限审计。

没有新环境变量、Milvus schema 或对象存储变更。只读统计不改变归档冻结和 AI 人工确认流程。

## 文件与验收

- 数据访问及签名 SQL：`src/modules/dashboard/repositories.ts`。
- 业务组装与权限复查：`src/modules/dashboard/service.ts`、`scope.ts`。
- 时间、输入与 DTO：`calendar.ts`、`schemas.ts`、`types.ts`。
- API / 页面：`src/app/api/dashboard/stats/route.ts`、`src/app/dashboard/`。
- 组件及缩放：`src/components/dashboard/`、`chart-scale.ts`。
- RBAC 接入：User schema、用户角色校验、个人会话/密码 API、导航和首页。
- 单测：`src/modules/dashboard/*.test.ts` 及导航测试。
- 真实 MySQL：`tests/integration/dashboard.test.ts`；浏览器：`e2e/dashboard.spec.ts`。

通过 `node scripts/test-project-ia.mjs` 在独立合成数据库运行集成、常规 E2E 和独立流式 E2E；不向演示库写入验收数据。Dashboard 截图在 `test-results/dashboard-evidence/`，包括桌面、移动、空数据、错误和重试/降权处理。真实模型、MinerU 等未启用测试单独报告，不将协议夹具视为在线供应商验证。

建议提交信息：`feat(dashboard): add scoped PMO portfolio analytics`。

最终验证（2026-10-19）：lint、typecheck 通过；78 个单测文件 490 项通过；真实 MySQL 集成 160 项通过、2 项 live 测试跳过；常规 E2E 103 项通过，独立流式组 8 项通过。常规组暂跳过的 8 项流式测试已在独立组执行，最终未启用的是 4 项既有 Worker E2E。PMO 专项为 9 项真实数据库测试、3 项浏览器测试。

完整验收日志 `test-results/dashboard-verified-acceptance.log`，最终单测日志 `test-results/dashboard-final-unit.log`。一项既有文档结构回滚测试因真实 DDL 耗时略超 5 秒默认窗口，将该项超时设为 15 秒后，全量重跑通过，原断言完整保留。
