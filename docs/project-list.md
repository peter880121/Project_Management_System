n# 项目看板：聚焦当前项目与受限检索

`/projects` 默认展示 PLANNING、ACTIVE；待验收、已暂停、已归档、已取消及历史 COMPLETED 通过状态筛选主动查看，“全部”视图显式启用。这里只改变读取与呈现，不改变生命周期或冻结规则。

搜索支持项目名称、描述的关键词匹配，最多 100 字。按 Enter 或点击搜索提交，可与状态、排序组合。默认按创建时间倒序，名称排序为另一选项，两种排序都以 ID 作稳定次序。每页 12 个项目。

URL 参数：`view=current|all`、`status=PLANNING|ACTIVE|...`、`q`、`sort=created_desc|name_asc`、`page`。兼容旧 `status=ALL`；未知值安全回到默认。搜索与状态切换回到第一页，翻页保留其他条件；空结果提供搜索全部状态与恢复默认入口。页码超过结果范围时重定向到有效页。

项目卡片进入任务看板时，只在存在筛选条件时附带 `returnTo`，看板返回链接与面包屑均指向该列表。目的地严格限定 `/projects` 并重新解析白名单参数，不接受外部 URL 或其他业务路径。浏览器返回与刷新通过 URL 恢复条件，不保存到全局账号偏好。

查询由 `list-repository.ts` 统一完成：授权范围来自既有 `visibleProjectWhere`，与关键词 OR 条件使用 AND 组合；`count` 统计当前筛选结果，`groupBy` 在授权范围和关键词下统计各状态数量，`findMany` 仅查询当前页必要字段。LIKE 的 `%`、`_`、反斜线作为字面字符处理。新建成功提示也单独按权限查 ID，不依赖项目恰好位于当前页。

读取使用一个 RepeatableRead 事务，使数量、状态和当前页处于相同快照。状态数量随关键词变化，不随所选状态收窄，以便比较和切换。卡片任务数排除已取消任务，显示为“有效任务”。普通 PM、QA、MEMBER 继续只看已有权限范围，ADMIN 沿用全局项目访问权限；PMO 仍进入数据决策中心。

不新增依赖、数据模型或迁移，不改变 `/api/projects` 的旧响应结构，也不写入演示数据或审计记录。使用现有权限/状态索引；包含式关键词搜索无法承诺通过普通 B-tree 加速，大规模部署若有慢查询证据，再评估独立的全文检索方案。

主要文件：

- `src/app/projects/page.tsx`：页面、状态入口、卡片与分页。
- `src/components/projects/project-list-filters.tsx`：原生 GET 搜索表单，无需额外状态管理依赖。
- `src/modules/projects/list-query.ts`：Zod 输入、查询条件与安全返回地址。
- `src/modules/projects/list-repository.ts`：有权限范围的聚合与分页查询。
- `src/app/projects/[projectId]/board/page.tsx`、`task-board.tsx`：返回筛选列表。
- `list-query.test.ts`、`tests/integration/project-list.test.ts`、`e2e/project-list.spec.ts`：输入边界、隔离 MySQL 与端到端流程。
