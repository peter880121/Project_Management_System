# 需求管理

项目入口：`/projects/[projectId]/requirements`。需求贯穿建设、验证测试和维护，不与 WBS 阶段绑定。

## 业务闭环

- 客户诉求：待分诊 → 待澄清／延期／拒绝／重复／整理为正式需求。处理结果必须说明原因；重复诉求必须指向本项目需求。
- 正式需求：草稿 → 待评审 → 已批准 → 实施中 → 待验证 → 待客户确认 → 已关闭。
- QA/ADMIN 独立评审并通过密码签署批准；禁止自审。密码不保存、不写审计。
- PM 登记外部客户确认凭证，不代表客户本人完成电子签名。
- 已批准需求发生变化：填写范围、工期、成本、风险影响后创建草稿变更，原批准版本继续保留。新版本重新批准后，必须按新版本重新验证。
- 草稿可填写原因取消；已批准需求的取消须独立 QA/ADMIN 密码签署。取消终态不可恢复。
- 归档项目继续冻结。维护工作在独立维护项目受理，在来源记录中注明原项目；本模块不会重新打开归档项目。

## 图片与计划／实际

新建诉求、正式需求及编辑草稿均支持图片。每条记录最多 8 张，每张 5 MB，接受经文件头检查的 PNG/JPEG/WebP。SVG 不接受。

图片使用现有 MinIO 存储封装，独立附件元数据保存 SHA256；不伪装成可解析的 PDF 文档，不自动进入 RAG。图片通过带项目权限检查的私有接口预览，返回 `private, no-store` 和 `nosniff`，不公开存储 key。提交评审后锁定附件；原始诉求转换后图片仍保留来源关系。

业务记录先保存，随后上传图片。图片失败时明确提示“记录已保存”，可从草稿或诉求补传，避免重复创建需求。提交数据库失败时补偿删除本次对象；若对象删除也失败，服务端记录不含正文的清理告警。极端进程中断可能留下无元数据对象，需结合 MinIO 运维清理，不能据此删除任何已登记证据。

| 字段 | 含义 |
|---|---|
| `RequirementRevision.dueDate` | 当前内容版本的预计完成日期，新建必填，批准后变更需重新评审 |
| `Requirement.dueDate` | 当前批准版本的计划投影；首次批准前显示草稿计划 |
| `Requirement.completedAt` | 关闭需求时填写的实际完成日期，不允许未来日期 |
| `Requirement.createdAt` | 系统登记时间，独立于交付日期 |

界面按业务日历展示日期，使用香港时区确定“今天”；数据库统一以 `YYYY-MM-DDT00:00:00.000Z` 编码日期。预计和实际日期属于需求，独立于任务自己的计划与实际。新版本批准时清空当前实际完成日期，历史关闭决定及原日期仍保留。

## 数据与一致性

扩展现有 Requirement；新增诉求、不可修改版本、变更单、多任务关联、决策、测试执行、基线、图片附件八个模型。

- `rowVersion` 管理并发编辑；`version`/`draftVersion`/`approvedVersion` 管理内容版本，两者分离。
- 每次保存草稿追加内容快照，不覆盖历史版本。JSON 的 SHA256 使用规范化键顺序，兼容 MySQL JSON 重排。
- 测试执行绑定需求版本、用例标题哈希和文档哈希。旧版本、改变过定义的测试不能充当新验证结果。
- 旧 Requirement/TestCase/Task 关联保留。历史记录 `managed=false`，不伪造计划日期或历史验收标准；原追溯功能仍可查看和维护历史记录。
- 新需求统一从新 API 创建，旧追溯接口拒绝创建需求及修改 managed 需求内容。
- 新需求与任务支持多对多，保留 `Task.requirementId` 作为兼容的主要关联。
- 新业务表复用 `medpm_assert_project_write`，复用项目锁、事务内权限复查和 Capabilities；未增加平行冻结机制。

## 验证、基线与项目结项

关闭需求前检查当前批准版本的测试执行、关联任务、必需交付物及客户确认凭证。测试证据、批准内容、决策和基线在数据库层禁止 UPDATE/DELETE。

最新交付基线代表本轮完整承诺范围，必须包含本项目全部已批准且未取消的需求，不能通过少选需求隐藏缺口。基线建立后新增批准需求，也会提示重新建立完整基线。需求批准后未建立基线，或者基线版本没有完成验证与客户确认，会形成 `REQUIREMENT_GAPS`。原始、延期和未批准诉求不自动成为交付承诺。已按独立签署流程取消的基线需求保留取消证据，视为正式撤销承诺。

结项快照升级为 V5，保存需求基线、需求版本及验证/审批证据引用。旧快照版本及没有 managed 需求的旧指纹保持兼容。结项体检即时失效检查包括需求、基线、任务关联、用例和验证记录的变化。

## API

统一前缀 `/api/projects/[projectId]`：

- `GET/POST /requirements`：分页、搜索、状态/优先级/负责人筛选与创建。
- `GET/PATCH /requirements/[id]`：详情和追加草稿版本。
- `POST /requirements/[id]/[operation]`：独立状态操作，禁止任意 PATCH 审批状态。
- `POST /requirements/[id]/images`、`GET /requirements/images/[imageId]`：上传和私有预览。
- `GET/POST /requirement-intakes`、`PATCH /requirement-intakes/[id]`：受理与分诊。
- `POST /requirement-intakes/[id]/images`：补充诉求图片。
- `GET/POST /requirement-baselines`：只读基线查询与建立。

写操作在项目锁与事务中复查权限、状态和乐观版本，并原子写入审计。409 代表并发/状态冲突；P2028 返回 503“系统繁忙，请重试”。

## 迁移与验证

迁移：`20261029000000_requirements_management`，增量且可重放。历史业务行和审计不回填或改写。回滚脚本只允许在尚未产生新模块证据时执行；有证据则拒绝回滚。

验证命令：

```powershell
pnpm lint
pnpm typecheck
pnpm test
node scripts/test-project-ia.mjs --integration-only --integration-file=tests/integration/requirements.test.ts
# 全量集成测试按文件隔离，避免冻结和回滚夹具互相污染
node scripts/test-project-ia.mjs --integration-isolated
node scripts/test-project-ia.mjs --e2e-only e2e/requirements.spec.ts e2e/traceability.spec.ts
```

测试使用隔离数据库、合成账号和存储夹具，不向演示项目注入测试数据。AI 去重、内容润色和影响分析不在本次自动执行范围内，未来接入仍须人工确认。
