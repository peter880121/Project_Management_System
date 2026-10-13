# MedPM-AI

面向医疗软件交付的 AI 原生合规与效率平台。AI 辅助 WBS 分解与工期预估、合规审计追踪、资源冲突与风险预警；建议默认待确认，关键决策可追溯。本项目仅用于合成数据，禁止录入真实患者信息（PHI）。

## 技术栈

Next.js 15 App Router、TypeScript strict、Tailwind CSS、shadcn/ui 基础配置、Prisma + MySQL 8、Milvus、MinIO、MinerU 集成预留、Vitest 和 Docker Compose。Redis 作为可选异步任务服务。

## 本地启动

1. 安装 Node.js 20.9+ 和 pnpm 10。
2. 复制 `.env.example` 为 `.env`，按文件注释生成并设置 `SESSION_SECRET`（至少 32 个随机字节）。示例数据库凭据仅用于本地开发；部署前必须替换所有密码。
3. 启动依赖：

   ```powershell
   docker compose up -d mysql etcd minio milvus
   ```

4. 安装依赖并应用初始 Prisma migration：

   ```bash
   pnpm install
   pnpm db:generate
   pnpm db:deploy
   $env:LOCAL_DEV_SEED_PASSWORD = "set-a-local-password"
   pnpm db:seed
   pnpm vector:init
   pnpm dev
   ```

5. 打开 `http://localhost:3000`。健康 API `http://localhost:3000/api/health` 也要求有效会话；Redis 可按需通过 `docker compose --profile async up -d redis` 启动。

也可以用 `docker compose up --build` 启动整套服务。schema 更新后，本地用 `pnpm db:migrate --name <migration_name>` 生成并应用 migration，提交生成的 migration 目录；部署时运行 `pnpm db:deploy`。`pnpm db:seed` 通过事务写入固定 ID 的合成样例，可重复运行；`pnpm vector:init` 创建并加载 `documents` collection。第二阶段 migration 附有结构回滚 `down.sql`；它会删除第二阶段新增的数据，只应在可丢弃环境执行。Prisma 不会自动执行 down migration，生产回滚应使用前向修复 migration。

## 认证数据准备

`pnpm db:seed` 通过事务写入固定 ID 的合成样例，可重复运行。认证测试账号密码从 `LOCAL_DEV_SEED_PASSWORD` 读取（至少 8 个字符，不写入源码），账号为 `admin@medpm.local`、`pm@medpm.local`、`member@medpm.local`、`qa@medpm.local`、`pending@medpm.local`、`disabled@medpm.local`。system user 固定 ID 为 `00000000-0000-4000-8000-0000000000f0`，供系统审计事件关联。阶段 1 migration 允许旧账户的 `passwordHash` 暂时为空；数据完成回填后再通过单独 migration 改为必填。

## 关键设计

- RBAC 角色在 Prisma 中先行建模；新增 API 时必须先做权限校验。
- AI 建议与正式任务分开确认，不能直接将建议当作已批准业务事实。
- `AIRecommendation` 独立存放模型生成的 JSON 建议，初始状态固定为 `PENDING_CONFIRMATION`；后续人工确认流程应在同一事务中记录审核人、结果及审计事件。
- `AuditLog` 保留 actor、action、entity、before/after、IP、user agent 和毫秒时间戳字段。涉及 MySQL 写入应在同一事务内写业务变更和审计记录。
- API 使用 HMAC 签名的 HttpOnly 会话 cookie，服务端从 MySQL 读取当前角色；`SESSION_SECRET` 至少 32 字节。账号密码验证仍由后续认证集成提供，未认证请求默认返回 401。
- `GET /api/audit` 仅 ADMIN 和 QA 可访问；审计页 `/audit` 支持按项目、操作人、操作类型和时间范围筛选。MySQL triggers 阻止 AuditLog 更新和删除。
- `Project.ownerId` 在升级时允许为空，因为历史项目可能没有可关联的 User；新建项目流程应要求指定负责人。
- `AiSuggestion` 保存输入、输出及 `PENDING` 人工审核状态。原 `AIRecommendation` 表保留兼容已有数据。
- `Requirement`、`TestCase` 与项目形成需求到测试的关系链；`SyncFailure` 留存向量同步失败载荷和重试次数。
- 初始 MySQL migration 位于 `prisma/migrations/20261011000000_init`；主键是 UUID `CHAR(36)`，时间字段是 `DATETIME(3)`，表使用 InnoDB 与 utf8mb4。
- Milvus SDK 仅由 `src/modules/vector` 使用。向量写失败要可重试，检索失败应降级为 MySQL 关键词搜索并记下降级信息。
- `src/modules/vector/documents-collection.ts` 定义 `documents` collection（1536 维向量、HNSW/COSINE）；首次调用 `ensureDocumentsCollection()` 时创建并加载。`pnpm vector:init` 可在部署或本地启动时手动初始化。
- 健康检查返回 MySQL、Milvus、MinIO 的连通状态；Compose 会在启动时创建业务与 Milvus 所需的 MinIO buckets。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

初始骨架尚未实现登录、权限中间件、AI Agent、MinerU 流程、Milvus 重试队列、检索降级和审计写入服务；目录与 schema 只确立边界，不能代替这些功能实现。
