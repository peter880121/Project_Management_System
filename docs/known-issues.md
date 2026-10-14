# 已知问题

## 问题 6：任务列表 GET 曾间歇性返回 500

- **现象：** 曾观察到连续两次成功 GET 后，第三次 `GET /api/projects/[projectId]/tasks` 返回 500；最近一次 E2E 未复现。
- **触发时机：** 历史日志显示创建任务后约 2.2 秒出现 500。2026-10-13 最近一次运行中，初始加载、创建后刷新、状态更新后刷新三次 GET 均返回 200。
- **已排除：** 历史运行中 POST、认证、Zod 校验、`createTask` 和 Prisma 查询均成功；POST 返回 taskId `3af23210`，任务数由 18 增至 19。最近运行中第三次查询、服务端响应序列化和浏览器 JSON 解析也全部成功（列表数量保持 20）。
- **当前判断：** 间歇性问题，根因仍不确定。RSC 缓存或组件重渲染时序异常仍只是待验证假设；本次成功结果不能证明问题已修复。
- **优先级：** P2。
## P3：邀请码比较的理论时序侧信道

注册 API 使用直接字符串比较校验邀请码。理论上响应耗时可能泄露部分比较信息；MVP 接受该风险，上线前改为定时安全比较并复核错误响应路径。

## P3：重复邮箱与正常注册的响应时间差

重复邮箱会在创建用户前被发现并返回统一 409，但此路径与成功注册（包含 bcrypt 和写入）可能存在响应耗时差，攻击者可能据此枚举账号。MVP 接受该风险，上线前评估统一耗时策略并增加速率限制。

## P3：PENDING 登录提示可能用于枚举邮箱

登录 API 对 PENDING 账号明确返回“等待管理员激活”，该提示有助于用户理解后续流程，但也会确认对应邮箱已注册。MVP 接受该风险；上线前评估是否改为统一认证失败文案，或通过已验证的邮箱渠道通知账号状态。

## P3：E2E 积累 Session 和测试账号

任务 E2E 通过登录 API 创建真实 Session，目前 fixture 不清理 Session 行。auth spec 在 `afterAll` 清理自身测试账号的所有 Session，并断言清理后为 0，不影响其他 spec。

auth spec 每次运行创建独立合成账号，邮箱格式为 `login-test-*@medpm.local` 和 `register-test-*@medpm.local`。账号及其 AuditLog 保留以维持审计关联，因此账号会逐次积累；异常终止也可能跳过 Session 清理。

缓解：`prisma migrate reset` 会清空测试数据库（包括测试账号、Session 和审计记录），仅用于可丢弃的本地测试库，执行后需按项目流程重建测试数据。单独运行 `pnpm db:seed` 不会清理这些账号或 Session。登录时会惰性删除该用户已过期的 Session，未来可增加受控的测试数据清理流程。

## P3：E2E 前需确保没有手动 dev server 在跑

- **现象：** 如果本地手动运行着 `pnpm dev`，Playwright 会复用该 server；测试通过后进程可能不退出，因为 Playwright 只会关闭自己启动的 server。
- **规避：** 运行 `pnpm test:e2e` 前，先确保没有其他 `pnpm dev` 在运行。
- **可选改进：** 在 `test:e2e` 脚本中增加前置检查，或改用固定端口检测。

## P3：Windows 下 Playwright 启动的 dev server 偶发关闭卡住

- **现象：** Windows 本地运行中，测试用例已全部完成，但 Playwright 在关闭自身启动的 Next.js dev server 时偶发不退出；根因尚未确认。
- **Workaround：** 先启动 dev server，再设置 `E2E_BASE_URL=http://localhost:4000` 运行 E2E，复用已启动的服务，避开 Playwright 的启动/关闭流程。测试后由启动方关闭服务。
- **CI：** 使用此 workaround 时，CI 环境需要预先启动 dev server、等待就绪，并设置 `E2E_BASE_URL`；CI 负责在结束时关闭服务。服务与测试进程须使用一致的数据库、SESSION_SECRET、测试密码及邀请码配置。
