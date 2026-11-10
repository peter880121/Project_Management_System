// Stateful synthetic project rehearsal. Never seeds DONE/APPROVED business evidence.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { typescriptRequire } from "./lib/load-typescript.mjs";

const source = new URL(process.env.DATABASE_URL || "");
const requestedDatabase = process.argv.find(value => value.startsWith("--target-database="))?.split("=")[1];
const inPlace = Boolean(requestedDatabase);
const enhanced = inPlace || process.argv.includes("--enhanced");
if (inPlace) {
  assert.equal(requestedDatabase, source.pathname.slice(1), "Target must exactly match the configured application database");
  assert.match(requestedDatabase, /^medpm_demo_[a-zA-Z0-9_]+$/);
  assert.equal(process.env.SIMULATION_PASSWORD, "test1234", "Explicit simulation password required");
}
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local isolated testing only");
const username = decodeURIComponent(source.username);
if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error("Invalid database account");
const database = requestedDatabase ?? `medpm_sim_202604_${Date.now()}_${randomBytes(3).toString("hex")}`;
if (!inPlace) assert.match(database, /^medpm_sim_202604_\d{13}_[a-f0-9]{6}$/);
const target = new URL(source); target.pathname = `/${database}`;
const rootUrl = new URL(source); rootUrl.username = "root"; rootUrl.password = process.env.MYSQL_ROOT_PASSWORD; rootUrl.pathname = "/mysql";
const adminDb = new PrismaClient({ datasources: { db: { url: rootUrl.toString() } } });
const originalDb = new PrismaClient({ datasources: { db: { url: source.toString() } } });
const stamp = new Date().toISOString().replace(/[-:.]/g, "");
const folder = resolve("output", "half-year-simulation", stamp);
const privateFolder = resolve(".maintenance", `half-year-${stamp}`);
mkdirSync(folder, { recursive: true }); mkdirSync(privateFolder, { recursive: true });
const results = [];
const manifest = { database, startedAt: new Date().toISOString(), businessPeriod: ["2026-04-01", "2026-09-30"], mode: "real business services + MySQL + MinIO; retrospective business dates; real execution audit timestamps", status: "RUNNING", results, gaps: ["Historical weekly expectations, punctuality and scheduled reminders not replayed", "Downstream EMR test results are synthetic workflow inputs, not evidence of an implemented EMR", "This runner does not call live LLM, MinerU or vector indexing", "Browser coverage is executed separately"] };
const save = () => writeFileSync(resolve(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
manifest.inPlace = inPlace;
save();
async function check(name, work) {
  const start = Date.now();
  try { const evidence = await work(); results.push({ name, status: "PASSED", durationMs: Date.now() - start, evidence }); console.log(`PASS ${name}`); save(); return evidence; }
  catch (error) { results.push({ name, status: "FAILED", message: error.message, durationMs: Date.now() - start }); save(); throw error; }
}
async function denied(work, status) {
  try { await work(); } catch (error) {
    const frozen = error.projectStatus === "ARCHIVED" || String(error.message).includes("ER_ARCHIVED_PROJECT");
    const actual = error.status ?? (frozen ? 403 : undefined);
    if (status) assert.equal(actual, status);
    else assert(frozen, "SQL拒绝必须明确来自归档冻结保护");
    return { rejected: true, status: actual ?? "SQL_ERROR" };
  }
  throw new Error("Expected operation to be rejected");
}
async function counts(db) { return { projects: await db.project.count(), tasks: await db.task.count(), users: await db.user.count(), audits: await db.auditLog.count(), weeklyReports: await db.weeklyReport.count() }; }
const names = [
  ["陈思远", "PM", "siyuan.chen", "项目交付部", "医疗信息化项目经理", 9, "2021-03-08", "需求协调、进度、风险及验收"],
  ["林若涵", "MEMBER", "ruohan.lin", "解决方案部", "业务分析师", 6, "2022-06-13", "业务调研、需求规格与追溯"],
  ["周明哲", "MEMBER", "mingzhe.zhou", "研发部", "技术负责人", 10, "2020-04-20", "架构、技术评审与集成决策"],
  ["许嘉宁", "MEMBER", "jianing.xu", "研发部", "门诊前端工程师", 5, "2023-02-06", "门诊表单、交互与单元验证"],
  ["沈亦辰", "MEMBER", "yichen.shen", "研发部", "住院前端工程师", 4, "2023-08-14", "住院病历、模板与单元验证"],
  ["顾承宇", "MEMBER", "chengyu.gu", "研发部", "后端开发工程师", 7, "2021-11-01", "服务接口、RBAC与审计"],
  ["陆景行", "MEMBER", "jingxing.lu", "集成服务部", "系统集成工程师", 6, "2022-05-09", "HIS、LIS、PACS接口联调"],
  ["苏沐晴", "MEMBER", "muqing.su", "数据服务部", "数据工程师", 5, "2022-09-19", "合成数据映射、迁移与核对"],
  ["何知远", "MEMBER", "zhiyuan.he", "测试部", "软件测试工程师", 6, "2021-07-12", "测试用例、缺陷与回归"],
  ["唐予安", "MEMBER", "yuan.tang", "技术运维部", "运维工程师", 7, "2020-12-07", "部署、备份恢复与上线回退"],
  ["叶清禾", "MEMBER", "qinghe.ye", "项目交付部", "实施培训工程师", 4, "2023-03-20", "实施配置、操作手册与培训"],
  ["梁静宜", "QA", "jingyi.liang", "质量管理部", "独立质量负责人", 9, "2020-08-17", "独立需求与交付审批、结项审查"],
  ["程修文", "ADMIN", "xiuwen.cheng", "信息技术部", "平台管理员", 8, "2021-01-11", "账号管理与独立最终归档"],
];
const topics = ["门诊病历新建", "门诊病历草稿", "门诊病历检索", "门诊病历模板", "门诊必填校验", "住院首次病程", "住院日常病程", "出院小结", "住院模板配置", "病历版本保留", "病历质控规则", "质控问题反馈", "质控整改追踪", "病历时限提醒", "病历状态查询", "医生角色权限", "护士只读权限", "管理员授权", "关键操作审计", "导出范围审计", "HIS就诊信息接口", "LIS检验结果接口", "PACS报告接口", "接口重试与幂等", "接口失败告警", "合成基础字典迁移", "合成病历迁移", "迁移总量核对", "备份与恢复", "运行监控与告警"];
const phases = [
  ["启动与规划", "2026-04-01", "2026-04-10"], ["需求调研与确认", "2026-04-13", "2026-04-30"],
  ["设计与环境准备", "2026-05-04", "2026-05-15"], ["配置与开发", "2026-05-18", "2026-07-10"],
  ["集成与系统测试", "2026-07-13", "2026-07-31"], ["UAT与培训", "2026-08-03", "2026-08-21"],
  ["上线与试运行", "2026-08-24", "2026-09-18"], ["验收与归档", "2026-09-21", "2026-09-30"],
];
const deliverableNames = [
  [0,"项目章程与范围边界",0],[0,"实施计划与WBS资源计划",0],[0,"组织沟通及质量管理约定",0],
  [1,"调研记录与差异分析",1],[1,"需求规格与验收标准",1],[1,"需求基线与追溯矩阵",1],
  [2,"总体架构与详细设计",2],[2,"权限矩阵与审计设计",5],[2,"接口规范与字段映射",6],[2,"迁移方案与核对规则",7],[2,"测试计划与用例集",8],
  [3,"环境部署与检查记录",9],[3,"病历配置及模板评审",10],[3,"开发完成与单元验证",3],[3,"接口联调报告",6],[3,"迁移预演与核对报告",7],
  [4,"系统权限及安全测试报告",8],[4,"缺陷与回归关闭清单",8],
  [5,"UAT记录与客户确认凭证",1],[5,"培训材料签到与考核",10],[5,"用户操作手册",10],
  [6,"上线回退方案与演练记录",9],[6,"上线评审与切换记录",0],[6,"试运行与问题关闭报告",9],[6,"运维备份恢复与移交清单",9],
  [7,"验收申请与交付总清单",0],[7,"验收报告与遗留事项",0],[7,"总结复盘与归档索引",0],
];
let db;
let originalRows;
const originalModels = ["project", "task", "user", "weeklyReport", "auditLog"];
const hashRows = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  manifest.sourceCountsBefore = await counts(originalDb);
  if (inPlace) await check("目标库备份与原有数据基线", async () => {
    originalRows = {};
    for (const model of originalModels) originalRows[model] = await originalDb[model].findMany({orderBy:{id:"asc"}});
    writeFileSync(resolve(privateFolder,"original-rows.json"),JSON.stringify(originalRows));
    const backup = resolve(privateFolder,"before.sql");
    execFileSync("C:/MySQL/MySQL Server 8.0/bin/mysqldump.exe", ["--host",source.hostname,"--port",source.port||"3306","--user",username,"--single-transaction","--routines","--triggers","--events","--no-tablespaces","--set-gtid-purged=OFF",`--result-file=${backup}`,database], {env:{...process.env,MYSQL_PWD:decodeURIComponent(source.password)},stdio:"pipe",windowsHide:true});
    assert(statSync(backup).size > 1000);
    const pending = await originalDb.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL`;
    assert(pending.every(row=>row.finished_at),"Unfinished migration prevents target run");
    return {database,backup:resolve(privateFolder,"before.sql"),bytes:statSync(backup).size,sha256:createHash("sha256").update(readFileSync(backup)).digest("hex"),baseline:manifest.sourceCountsBefore};
  });
  if (!inPlace)
  await check("隔离数据库迁移", async () => {
    const grants = await adminDb.$queryRaw`SELECT Host host FROM mysql.user WHERE User=${username}`;
    assert(grants.length && grants.every(row => /^[a-zA-Z0-9_.%:-]+$/.test(row.host)));
    await adminDb.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    for (const { host } of grants) await adminDb.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${username}'@'${host}'`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "pipe", windowsHide: true });
    return { database, envFileChanged: false };
  });
  process.env.DATABASE_URL = target.toString();
  const require = typescriptRequire(resolve("."));
  const load = path => require(resolve("src", path));
  db = load("lib/prisma.ts").prisma;
  const audit = load("modules/audit/service.ts");
  const reqs = load("modules/requirements/services.ts");
  const projects = load("modules/projects/services.ts");
  const assets = load("modules/assets/services.ts");
  const docs = load("modules/documents/services.ts");
  const weekly = load("modules/weekly-reports/services.ts");
  const planning = load("modules/planning/services.ts");
  const { transitionProject } = load("modules/projects/acceptance.ts");
  const { setProjectMember } = load("modules/projects/members.ts");
  const users = load("modules/users/services.ts");
  const { hashPassword } = load("modules/auth/password.ts");
  const password = enhanced ? process.env.SIMULATION_PASSWORD : randomBytes(24).toString("base64url");
  if(enhanced) assert.equal(password,"test1234");
  const domain = inPlace ? `rehearsal-${Date.now()}.example` : "chengchuan.example";
  const actor = id => ({ actorId: id, ip: "127.0.0.1", userAgent: "MedPM synthetic half-year rehearsal / retrospective business dates" });
  const people = [];
  await check("13名实名合成账号与资料", async () => {
    const bootstrap = inPlace ? await db.user.findFirstOrThrow({where:{role:"ADMIN",status:"ACTIVE",isSystem:false}}) : await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { name: names[12][0], email: `${names[12][2]}@chengchuan.example`, role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword(password) } });
      await audit.recordAudit(tx, { ...actor(user.id), action: "USER_CREATED_BY_ADMIN", entityType: "User", entityId: user.id, after: { syntheticOnly: true, bootstrap: true, role: "ADMIN" } });
      return user;
    });
    for (const [index, [name, role, local, department, position, experienceYears, joinedAt, skills]] of names.entries()) {
      const user = index === 12 && !inPlace ? bootstrap : await users.createUserByAdmin({ ...actor(bootstrap.id), name, role, email: `${local}@${domain}`, initialPassword: password });
      people.push({ id: user.id, name, role, email: user.email, employeeNumber: `CC${joinedAt.replaceAll("-", "")}${String(index + 1).padStart(2,"0")}`, department, position, experienceYears, joinedAt, skills, office: "杭州研发交付中心（虚构）", extension: String(8101 + index), education: "计算机相关专业本科（合成资料）", biography: `具有${experienceYears}年软件交付相关经验；本次承担${skills}。`, manager: index > 0 && index < 11 ? "陈思远" : "独立管理岗位", weeklyHours: 40, plannedLeave: index === 6 ? ["2026-06-15", "2026-06-19"] : [], syntheticOnly: true });
    }
    writeFileSync(resolve(folder,"personnel.json"), JSON.stringify(people,null,2));
    writeFileSync(resolve(privateFolder,"credentials.json"), JSON.stringify({ database, password, accounts: people.map(({name,email,role})=>({name,email,role})) },null,2));
    return { accounts: people.length, members: people.filter(p=>p.role==="MEMBER").length, profile: "personnel.json", credentials: "private maintenance archive only" };
  });
  const [pm] = people, qa = people[11], admin = people[12];
  let project = await projects.createProject({ name: "澄川市仁和医院电子病历系统建设项目（半年合成模拟）", description: "2026-04-01至2026-09-30；1名PM、10名MEMBER；业务日期为模拟，审批审计为实际执行时间；无真实患者资料。", initializeStandardTasks: false }, actor(pm.id));
  manifest.projectId = project.id; save();
  const projectId = project.id;
  async function transition(action, who = pm, extra = {}) {
    const row = await db.project.findUniqueOrThrow({where:{id:projectId}});
    return transitionProject(projectId, action, {expectedRowVersion:row.rowVersion,requestKey:randomUUID(),...(row.currentAcceptanceId?{acceptanceId:row.currentAcceptanceId}:{}),comment:"合成项目独立审核，业务证据已逐项复核",...extra},actor(who.id));
  }
  await check("项目成员授权与启动",async()=>{
    for(const person of people.slice(1)) await setProjectMember(projectId,{userId:person.id,active:true,expectedVersion:0},actor(pm.id));
    project = await transition("activate"); assert.equal(project.status,"ACTIVE"); return {projectId,status:project.status};
  });
  const documentIndex=[];
  const documentDetails = {
    "项目章程与范围边界":"目标：9月30日前完成合成医院EMR建设交付闭环。范围：门诊、住院、质控、权限、三类模拟接口及合成迁移。范围外：真实患者数据、真实临床使用及法规认证。客户代表：赵文岚、孟书宁。PM陈思远统筹，重大范围调整需独立批准。",
    "实施计划与WBS资源计划":`建设周期：2026-04-01至2026-09-30。\n\n${phases.map(([n,s,e])=>`- ${n}：${s}—${e}`).join("\n")}\n\n120项叶子任务、11人建设团队；自然周容量40小时，首尾部分周24小时；陆景行6月15—19日休假。阶段出口依赖批准文件、任务签署及测试证据；关键延期先评估后调整。`,
    "组织沟通及质量管理约定":"陈思远负责范围、计划及提交；10名成员分别负责分析、架构、研发、集成、迁移、测试、运维和培训。梁静宜独立审批，程修文最终归档。每周个人周报、项目周报和例会；每月复盘。P0/P1缺陷不允许遗留进入验收，审批人与提交人必须独立。",
    "调研记录与差异分析":"访谈对象：赵文岚（医务科）、孟书宁（信息科）、徐清雅（护理部），均为虚构。发现：病历模板不统一、接口异常反馈不清、迁移核对及导出审计薄弱。形成40条诉求，30条转正式需求，其余保留澄清、延期、拒绝、重复或待分诊决定；不把未批准诉求算入交付承诺。",
    "需求规格与验收标准":topics.map((t,i)=>`- REQ-${String(i+1).padStart(4,"0")} ${t}：授权成功、非法输入拒绝、越权阻止、失败恢复四项验收维度；具体内容与批准版本见系统。`).join("\n"),
    "需求基线与追溯矩阵":"首版基线覆盖全部30条需求；五项批准变更后建立完整V2基线，一项变更撤回。每条需求关联4项任务、3条测试用例；当前版本测试与客户确认凭证绑定，不以旧版通过代替新版验证。完整ID映射见traceability.json及冻结验收快照。",
    "总体架构与详细设计":"合成目标系统分为门诊、住院、质控、集成、数据和运维模块。交互经统一服务层，写入进行权限校验及审计。外部接口失败进入明确失败或待重试状态，不静默丢失。实现细节为模拟设计输入，本轮验证MedPM对设计、变更及证据的管理流程。",
    "权限矩阵与审计设计":"PM：计划、分配、提交；MEMBER：本人任务执行；QA：独立审批、审计、测试验证；ADMIN：用户管理及最终归档。项目授权与系统角色同时检查。审计保留actorId、action、entityType、entityId、before、after、ip、userAgent、createdAt；写审计失败时业务回滚。",
    "接口规范与字段映射":"模拟HIS：encounterId→就诊标识；模拟LIS：orderId/resultCode→检验申请及结果；模拟PACS：studyId/reportStatus→检查及报告状态。标识统一SYN前缀；空标识拒绝、重复请求幂等、超时有界重试并登记失败。无真实医院连接与真实患者资料。",
    "迁移方案与核对规则":"来源：合成字典100条、合成病历1000条。步骤：快照→字段映射→试导入→总量/唯一键/必填项核对→异常隔离→重新导入。预期目标：重复键0、未解释差异0。失败回退到迁移前快照；核对失败不得进入切换。数量属于模拟目标，实际EMR迁移不在本轮执行范围。",
    "测试计划与用例集":"30条需求各3条用例，共90条：正常路径、非法输入、权限与恢复。每次测试记录批准需求版本、用例标题哈希及证据文件哈希。先记录一次失败验证拦截，再登记修复后通过；失败历史保留。真实软件执行与合成下游测试输入严格区分。",
    "环境部署与检查记录":`本轮MedPM使用${inPlace?"4000服务对应库内新增的独立项目，执行前完成备份，不变更既有业务":"独立MySQL库"}；真实MinIO以独立项目UUID存储文件。.env保留。上线检查：数据库可连接、对象上传下载哈希一致、角色授权正确、关键写入有审计。外部模型、MinerU及向量在线能力另行验证。`,
    "病历配置及模板评审":"合成模板：门诊初诊、门诊复诊、入院记录、首次病程、日常病程、出院小结。公共字段：SYN就诊标识、业务日期、记录状态、作者角色。必填约束与角色可见性由模拟医务科代表复核；内容为空或越权时拒绝提交。",
    "开发完成与单元验证":"模拟交付范围：门诊、住院、权限审计及质控功能。模块负责人逐项核对需求、异常提示及审计边界后提交交付包；研发实际软件构建不作为本轮已实现成果。MedPM自身准入结果另见测试执行报告，不把合成EMR功能当作真实代码测试通过。",
    "接口联调报告":"联调场景：HIS正常就诊消息、LIS结果回传、PACS报告状态；异常场景：缺少SYN标识、重复消息、超时、失败重试。输入与结果均为合成接口事件；记录字段映射、关联需求、责任人陆景行和独立复核结论。真实医院接口未连接。",
    "迁移预演与核对报告":"预演输入：100条合成字典、1000条合成病历。核对项：总量、唯一键、必填字段及映射一致性。异常先隔离后重跑，保留首次失败与修复记录。此处为模拟迁移报告；本轮真实数据库操作仅涉及MedPM项目管理数据。",
    "系统权限及安全测试报告":"MedPM实际检查：不同角色操作边界、独立审批、任务签署、需求当前版本验证、审计、导出及归档冻结。合成目标EMR用例仅作为业务输入。执行结果不得预填；以本轮manifest、集成回归及浏览器证据判断通过/失败/未测。",
    "缺陷与回归关闭清单":"20项合成下游缺陷，4项P1、16项P2；首项保留回归失败→重开→修复→通过历史。完整条目见management-registers.json。MedPM本轮实际发现的问题另列测试报告，不能用本清单把实际失败标为关闭。",
    "UAT记录与客户确认凭证":"模拟业务代表按门诊、住院、质控和接口场景确认范围；重点检查正常、异常与角色边界。客户代表赵文岚、孟书宁均为虚构；陈思远仅登记外部确认凭证，不代表客户电子签名。当前版本仍须完成独立验证后方可关闭需求。",
    "培训材料签到与考核":"模拟培训分为医生录入、护理查看、质控处理、运维恢复四场。培训负责人叶清禾；虚构学员赵文岚、徐清雅、孟书宁分别完成对应演练。考核内容为保存草稿、处理校验提示、查询授权记录和报告问题；补训后再次确认。签到与考核为合成业务证据。",
    "用户操作手册":"1.以本人角色登录；2.选择合成就诊记录；3.使用模板填写并保存草稿；4.处理必填校验后提交；5.查询授权内记录；6.遇接口失败登记SYN业务标识并联系运维。禁止共享账号、上传真实患者资料或绕过审批。",
    "上线回退方案与演练记录":"切换前核对批准范围、关键缺陷、备份、人员和通讯录。演练：停止模拟写入→备份→发布→健康检查→核心流程核对。健康检查失败或数据不一致即回退旧版本与快照，复核后再开放。负责人唐予安，PM决定推进；演练记录为合成下游事件。",
    "上线评审与切换记录":"评审条件：SIT/UAT证据、培训、备份恢复及回退方案齐备。PM陈思远组织，唐予安负责切换，梁静宜复核证据。模拟切换日期2026-08-24；此日期是业务输入，不冒充当日电子审批。未满足条件应延期，不自动推进上线。",
    "试运行与问题关闭报告":"观察期2026-08-24—2026-09-18。观察项：接口失败、业务校验、权限、响应和备份。18项合成问题保留责任人、期限与关闭说明；出现关键未关闭项则延长观察并阻断验收。真实生产运行和SLA不在本轮声明范围。",
    "运维备份恢复与移交清单":"移交内容：部署说明、环境标识、访问权限、备份策略、恢复步骤、接口映射、监控项及遗留问题。唐予安移交，孟书宁（模拟信息科）接收。恢复后需复核数据总量与关键记录；凭据单独保存在私有维护目录，不写入交付文档。",
    "验收申请与交付总清单":"申请范围：最新完整基线全部需求、120项任务、批准交付版本和测试证据。PM送审前运行结项体检；QA独立复核，首次驳回及第二轮送审保留；ADMIN核对当前轮次后归档。最终数量和哈希以document-index及冻结快照为准。",
    "验收报告与遗留事项":"判断标准：需求承诺闭环、任务签署齐全、必需交付物批准且文件可用、会议行动项有关联、导出可审计。历史准时率、真实模型/MinerU及向量在线验证列为覆盖限制。实际P0/P1缺陷不得通过本文件豁免，最终结论以执行报告为准。",
    "总结复盘与归档索引":"保留人员档案、需求版本及基线、WBS、测试执行、周报、会议、批准文件、审批记录和冻结快照。归档后仅可查看及合法导出；维护另建项目。经验：业务日期与真实操作时间分离、失败保留证据、下游模拟结果不能替代产品真实验证。",
  };
  async function document(title, body, date, owner=pm, taskId, previousId) {
    const code=`DOC-${String(documentIndex.length+1).padStart(3,"0")}`;
    const filename=`${code}-${title}.md`;
    const content=`# ${title}\n\n编号：${code}｜业务日期：${date}｜编制：${owner.name}｜提交：${pm.name}\n\n合成测试资料。业务日期不代表审批时间，系统审批与审计保留实际执行时间。\n\n${documentDetails[title]?`## 业务内容\n\n${documentDetails[title]}\n\n`:""}${body}\n\n## 评审及版本\n\n由${qa.name}独立评审；批准结果、文件版本和SHA256以系统记录为准。批准后更改须创建新版本。\n`;
    mkdirSync(resolve(folder,"documents"),{recursive:true}); writeFileSync(resolve(folder,"documents",filename),content);
    const bytes=Buffer.from(content);
    const uploaded=await docs.uploadDocument(projectId,{filename,mediaType:"text/markdown",bytes,uploadKey:randomUUID()},actor(pm.id));
    let d=await assets.createDeliverable(projectId,{name:title,documentId:uploaded.id,...(taskId?{taskId}:{})},actor(pm.id),previousId);
    d=await assets.mutateDeliverable(d.id,"submit",{rowVersion:d.rowVersion},actor(pm.id));
    if(enhanced && title==="接口规范与字段映射" && !previousId){
      d=await assets.mutateDeliverable(d.id,"review",{rowVersion:d.rowVersion,decision:"REJECTED",reviewComment:"缺少LIS超时重试及重复消息处理的验收证据，请补充后上传新版本。"},actor(qa.id));
      documentIndex.push({code,title,filename,date,owner:owner.name,documentId:uploaded.id,deliverableId:d.id,version:d.version,taskId:taskId??null,status:"REJECTED",sha256:createHash("sha256").update(bytes).digest("hex")});
      return document(title,body+"\n\nV2修订：LIS超时最多重试3次，重复消息以SYN业务键去重；补充异常用例及复核责任人陆景行。",date,owner,taskId,d.id);
    }
    d=await assets.mutateDeliverable(d.id,"review",{rowVersion:d.rowVersion,decision:"APPROVED",reviewComment:"已核对合成范围、责任人、可验证结论与关联证据，批准本版本。"},actor(qa.id));
    const downloaded=await docs.downloadDocument(uploaded.id,actor(qa.id));
    assert.equal(createHash("sha256").update(downloaded.bytes).digest("hex"),createHash("sha256").update(bytes).digest("hex"));
    const entry={code,title,filename,date,owner:owner.name,documentId:uploaded.id,deliverableId:d.id,version:d.version,taskId:taskId??null,sha256:createHash("sha256").update(bytes).digest("hex")};
    documentIndex.push(entry); writeFileSync(resolve(folder,"document-index.json"),JSON.stringify(documentIndex,null,2)); return entry;
  }
  // The first real upload is a fail-fast check of the actual configured object store.
  await check("真实MinIO上传审批下载与哈希",()=>document("项目测试边界与执行约定","范围：验证MedPM项目管理全周期。\n\n前提：独立数据库、13名合成账号、真实业务服务。\n\n判定：业务成功同时具备不可改写证据；真实EMR软件及外部AI供应商不在本轮主线验证范围。","2026-04-01"));
  const requirements=[], intakes=[], tasks=[], cases=[];
  async function action(row,operation,extra={},who=pm){return reqs.actOnRequirement(projectId,row.id,operation,{expectedRowVersion:row.rowVersion,requestKey:randomUUID(),comment:"合成需求经范围与验收标准核对后执行本次决定",...extra},actor(who.id));}
  await check("40条诉求分诊与30条需求独立批准",async()=>{
    for(let i=0;i<40;i++){
      const intake=await reqs.createIntake(projectId,{title:i<30?topics[i]:`补充诉求${i-29}：${topics[i%30]}`,content:"合成医院业务访谈：明确操作角色、正常路径、异常处理与验收边界，不含真实病历。",requester:["赵文岚（模拟医务科）","孟书宁（模拟信息科）","徐清雅（模拟护理部）"][i%3],source:"CUSTOMER",sourceReference:"2026年4月合成调研记录",requestKey:randomUUID()},actor(people[1].id)); intakes.push(intake);
      if(i<30){
        const fields={title:topics[i],content:`建设${topics[i]}能力；仅使用合成业务标识，按角色访问并保留关键操作证据。`,acceptanceCriteria:`授权角色可完成${topics[i]}；缺少必填信息明确拒绝；非授权角色不得读取或修改；失败可恢复且保留证据。`,dueDate:i>=25?"2026-09-18":"2026-08-21",ownerId:people[1+i%10].id,priority:i<20?"MUST":"SHOULD",category:i>=20&&i<25?"INTERFACE":i>=25?"DATA":"FUNCTIONAL",riskLevel:i===18?"HIGH":"NORMAL",discoveryPhase:"需求调研",targetRelease:"2026.09",requestKey:randomUUID(),intakeId:intake.id};
        let row=await reqs.createRequirement(projectId,fields,actor(pm.id)); row=await action(row,"submit");
        if(i===0) await denied(()=>action(row,"approve",{signaturePassword:password},pm),403);
        row=await action(row,"approve",{signaturePassword:password},qa); requirements.push(row);
      }else{const state=["CLARIFYING","DEFERRED","REJECTED","DUPLICATE","SUBMITTED"][(i-30)%5];await reqs.triageIntake(projectId,intake.id,{expectedRowVersion:intake.rowVersion,state,reason:"经模拟调研确认，按范围和信息完整性记录本次分诊决定",...(state==="DUPLICATE"?{requirementId:requirements[0].id}:{})},actor(pm.id));}
    }
    const baseline=await reqs.createBaseline(projectId,{name:"2026-04需求基线V1",requirementIds:requirements.map(r=>r.id)},actor(pm.id));
    return {intakes:40,requirements:30,baselineId:baseline.id};
  });
  await check("120项WBS任务与90条未执行用例",async()=>{
    for(let i=0;i<120;i++){
      const ri=i%30,pi=Math.floor(i/15),phase=phases[pi];
      const roleOwners=[[1,2,10],[1,2,6],[2,5,6,7,8,9],[3,4,5,6,7],[6,7,8],[1,8,10],[6,7,9,10],[1,2,8,9,10]];
      const ownerIndex=enhanced?(i===51?6:roleOwners[pi][i%roleOwners[pi].length]):1+i%10,owner=people[ownerIndex];
      const t=await audit.createTask({...actor(pm.id),projectId,title:`${String(pi+1)}.${String(i%15+1).padStart(2,"0")} ${phase[0]}：${topics[ri]}`,description:`责任人${owner.name}；需求${requirements[ri].number}；输出须通过评审后签署。`,phase:phase[0],estimateHours:16+(i%4)*8,plannedStartDate:phase[1],dueDate:phase[2],assigneeId:owner.id,requirementId:requirements[ri].id,requiresDeliverable:deliverableNames.some(([p],di)=>p===pi&&i===pi*15+deliverableNames.slice(0,di).filter(([prior])=>prior===p).length)});
      tasks.push({...t,phaseIndex:pi,ownerIndex});
      if(i>=15) await planning.updateTaskSchedule(t.id,{expectedVersion:t.scheduleVersion,plannedStartDate:phase[1],dueDate:phase[2],estimateHours:Number(t.estimateHours),dependencyIds:[tasks[i-15].id]},actor(pm.id));
    }
    for(let i=0;i<30;i++)for(const suffix of ["正常流程","缺失与非法输入","权限与失败恢复"]){const t=await projects.saveTraceability(projectId,{kind:"testCase",requirementId:requirements[i].id,title:`${topics[i]}—${suffix}`,status:"NOT_RUN"},actor(qa.id));cases.push({...t,requirementIndex:i,suffix});}
    return {tasks:tasks.length,testCases:cases.length};
  });
  if(enhanced) await check("初始计划固化及接口延期交接",async()=>{
    const baseline=await db.task.findMany({where:{projectId},orderBy:{id:"asc"}});
    writeFileSync(resolve(folder,"initial-task-plan.json"),JSON.stringify(baseline,null,2));
    await document("初始排期基线与变更控制",`120项任务初始日期、负责人、预计工时和排期版本保存在initial-task-plan.json，SHA256=${hashRows(baseline)}。调整后不覆盖该初始基线。\n\n事件：6月15—19日陆景行休假，第三方LIS测试接口未就绪；技术负责人周明哲临时接手联调。原计划7月10日完成，修订到7月14日，实际7月15日完成，保留一天偏差。`,"2026-04-10");
    const selected=tasks[51];
    await audit.assignTask({...actor(pm.id),taskId:selected.id,assigneeId:people[2].id}); selected.ownerIndex=2;
    const current=await db.task.findUniqueOrThrow({where:{id:selected.id}});
    await planning.updateTaskSchedule(current.id,{expectedVersion:current.scheduleVersion,plannedStartDate:"2026-05-18",dueDate:"2026-07-14",estimateHours:Number(current.estimateHours)+8,dependencyIds:[tasks[36].id]},actor(pm.id));
    return {baseline:"initial-task-plan.json",handoffTaskId:selected.id,originalDue:"2026-07-10",revisedDue:"2026-07-14",actualCompletion:"2026-07-15"};
  });
  await check("27周资源容量与休假登记",async()=>{
    for(let wi=0;wi<27;wi++){const monday=new Date(Date.UTC(2026,2,30+wi*7)).toISOString().slice(0,10);for(const person of people.slice(0,11))await planning.updateMemberCapacity(person.id,{weekStart:monday,hours:person.name==="陆景行"&&monday==="2026-06-15"?0:wi===0||wi===26?24:40,expectedVersion:0},actor(pm.id));} return {capacityEntries:297,leave:"陆景行 2026-06-15—2026-06-19"};
  });
  await check("6次需求变更及完整基线更新",async()=>{
    for(let i=0;i<6;i++){
      let r=await action(requirements[i],"change",{impact:{scope:`${topics[i]}增加异常输入说明`,schedule:"不改变9月交付里程碑，使用预留缓冲",cost:"增加4小时模拟工作量",risk:"重新评审并执行当前版本测试"}});
      if(i===5){r=await action(r,"withdraw-change");requirements[i]=r;continue;}
      const prior=await db.requirementRevision.findUniqueOrThrow({where:{requirementId_version:{requirementId:r.id,version:r.approvedVersion}}});
      r=await reqs.editRequirement(projectId,r.id,{title:r.title,content:`${prior.content}\n变更：补充异常输入校验及提示。`,acceptanceCriteria:`${prior.acceptanceCriteria}\n变更后须重新验证异常提示。`,dueDate:r.dueDate.toISOString().slice(0,10),ownerId:r.ownerId,priority:r.priority,category:r.category,riskLevel:r.riskLevel,discoveryPhase:"建设变更",targetRelease:"2026.09",expectedRowVersion:r.rowVersion},actor(pm.id));
      r=await action(r,"submit");if(i===4){r=await action(r,"return",{},qa);r=await action(r,"submit");}r=await action(r,"approve",{signaturePassword:password},qa);requirements[i]=r;
    }
    const b=await reqs.createBaseline(projectId,{name:"2026-07变更后完整需求基线V2",requirementIds:requirements.map(r=>r.id)},actor(pm.id));return {changeRequests:6,approved:5,withdrawn:1,baselineId:b.id};
  });
  // Live services validate every transition; the downstream work itself is simulated.
  for(let pi=0;pi<8;pi++)await check(`阶段${pi+1}：${phases[pi][0]}交付与签署`,async()=>{
    let local=0;
    for(const [p,title,ownerIndex] of deliverableNames){if(p!==pi)continue;const task=tasks[pi*15+local++];await document(title,`## 目的与范围\n\n完成${phases[pi][0]}阶段的${title}，仅覆盖本项目批准范围。\n\n## 执行与证据\n\n负责人：${people[ownerIndex].name}。关联任务：${task.title}（${task.id}）；关联需求：${requirements[(pi*15+local-1)%30].number}。\n\n执行：检查输入范围、角色分工、正常与异常流程、恢复措施及下游依赖；需求与用例明细见本轮结构化台账。\n\n## 结论与退出条件\n\n本文件是合成流程演练交付物。批准仅表示模拟交付包满足本轮管理测试约定，不代表真实EMR产品验证。未决问题必须记录责任人与期限，关键缺口不得带入上线。`,phases[pi][2],people[ownerIndex],task.id);}
    for(const stored of tasks.filter(t=>t.phaseIndex===pi)){
      let task=await db.task.findUniqueOrThrow({where:{id:stored.id}});const who=people[stored.ownerIndex];
      if(pi===0&&task.id===tasks[0].id)await denied(()=>audit.changeTaskStatus({...actor(people[10].id),taskId:task.id,status:"IN_PROGRESS",expectedRowVersion:task.rowVersion}),403);
      task=await audit.changeTaskStatus({...actor(who.id),taskId:task.id,status:"IN_PROGRESS",expectedRowVersion:task.rowVersion});
      if(pi===3&&stored.id===tasks[enhanced?51:45].id){task=await audit.changeTaskStatus({...actor(who.id),taskId:task.id,status:"BLOCKED",expectedRowVersion:task.rowVersion});task=await audit.changeTaskStatus({...actor(who.id),taskId:task.id,status:"IN_PROGRESS",expectedRowVersion:task.rowVersion});}
      await audit.changeTaskStatus({...actor(who.id),taskId:task.id,status:"DONE",actualHours:Number(task.estimateHours)+(pi===3?4:0),completedAt:enhanced&&stored.id===tasks[51].id?"2026-07-15":phases[pi][2],signaturePassword:password,signatureReason:"确认任务已完成",expectedRowVersion:task.rowVersion,expectedCompletionRoundId:task.completionRoundId});
    }
    if(enhanced){
      const checkpoint={phase:phases[pi][0],businessDate:phases[pi][2],actualObservedAt:new Date().toISOString(),tasks:await db.task.groupBy({by:["status"],where:{projectId},_count:true}),approvedDocuments:await db.deliverable.count({where:{projectId,status:"APPROVED"}})};
      assert.equal(await db.task.count({where:{projectId,id:{in:tasks.filter(t=>t.phaseIndex<=pi).map(t=>t.id)},status:{not:"DONE"}}}),0);
      mkdirSync(resolve(folder,"checkpoints"),{recursive:true});writeFileSync(resolve(folder,"checkpoints",`phase-${pi+1}.json`),JSON.stringify(checkpoint,null,2));
    }
    return {completedTasks:15,deliverables:local,businessDate:phases[pi][2]};
  });
  const testingEvidence=await document("需求逐项验证及客户确认汇编",`## 验证范围\n\n${topics.map((t,i)=>`${i+1}. ${t}：正常、异常、权限恢复三类场景；由何知远执行模拟业务验证，梁静宜复核。`).join("\n")}\n\n## 客户确认\n\n赵文岚（模拟医务科）和孟书宁（模拟信息科）确认合成范围符合演练要求。陈思远登记凭证；此记录不构成客户电子签名。\n\n## 边界\n\n用例状态为模拟下游验证输入；MedPM实际测试验证的是版本绑定、失败拦截、审批和追溯。`,"2026-09-18",people[8]);
  await check("30条需求当前版本验证与客户确认关闭",async()=>{
    for(let i=0;i<30;i++){
      let r=await db.requirement.findUniqueOrThrow({where:{id:requirements[i].id}});r=await action(r,"start");r=await action(r,"verify");
      const own=cases.filter(c=>c.requirementIndex===i);
      if(i===0){r=await action(r,"record-test",{testCaseId:own[0].id,result:"FAILED",documentId:testingEvidence.documentId},qa);await denied(()=>action(r,"confirm-verification",{},qa),400);
        if(enhanced){
          r=await action(r,"request-fix");
          let repair=await audit.createTask({...actor(pm.id),projectId,title:"DEF-001 门诊病历必填提示修复与回归",description:`失败用例${own[0].id}；合成下游缺陷；何知远复测，许嘉宁修复。`,phase:"集成与系统测试",estimateHours:8,plannedStartDate:"2026-07-20",dueDate:"2026-07-24",assigneeId:people[3].id,requirementId:r.id});
          repair=await audit.changeTaskStatus({...actor(people[3].id),taskId:repair.id,status:"IN_PROGRESS",expectedRowVersion:repair.rowVersion});
          repair=await audit.changeTaskStatus({...actor(people[3].id),taskId:repair.id,status:"DONE",actualHours:8,completedAt:"2026-07-24",signaturePassword:password,signatureReason:"确认任务已完成",expectedRowVersion:repair.rowVersion,expectedCompletionRoundId:repair.completionRoundId});
          r=await action(r,"verify");
          r=await action(r,"record-test",{testCaseId:own[0].id,result:"FAILED",documentId:testingEvidence.documentId},qa);
          r=await action(r,"request-fix");
          repair=await audit.changeTaskStatus({...actor(pm.id),taskId:repair.id,status:"IN_PROGRESS",expectedRowVersion:repair.rowVersion});
          await audit.changeTaskStatus({...actor(people[3].id),taskId:repair.id,status:"DONE",actualHours:12,completedAt:"2026-07-27",signaturePassword:password,signatureReason:"确认任务已完成",expectedRowVersion:repair.rowVersion,expectedCompletionRoundId:repair.completionRoundId});
          r=await action(r,"verify");
          manifest.defectEvidence={id:"DEF-001",taskId:repair.id,testCaseId:own[0].id,requirementId:r.id,history:["FAILED","FIXED","RETEST_FAILED","REOPENED","FIXED","PASSED"],syntheticDownstreamEvent:true};save();
        }
      }
      for(const c of own)r=await action(r,"record-test",{testCaseId:c.id,result:"PASSED",documentId:testingEvidence.documentId},qa);
      r=await action(r,"confirm-verification",{},qa);
      if(i===0)await denied(()=>action(r,"close",{completedAt:"2026-09-18"}),400);
      const linkedTasks=await db.task.findMany({where:{projectId,requirementId:r.id},select:{completedAt:true}});
      const completedAt=linkedTasks.map(t=>t.completedAt.toISOString().slice(0,10)).sort().at(-1);
      r=await action(r,"customer-confirm",{documentId:testingEvidence.documentId});r=await action(r,"close",{completedAt});assert.equal(r.workflowState,"CLOSED");requirements[i]=r;
    }return {closedRequirements:30,passedCurrentCases:90,failedHistoryPreserved:1};
  });
  await check("36次会议及行动项关联",async()=>{
    for(let i=0;i<36;i++){const task=tasks[i%120];await assets.createMeeting(projectId,{title:i<27?`项目周例会 W${String(i+1).padStart(2,"0")}`:`专题评审 ${i-26}`,meetingDate:new Date(Date.UTC(2026,3,1+Math.floor(i*182/36),2)).toISOString(),content:`主持：陈思远。参与：${people[task.ownerIndex].name}、梁静宜。\n议题：检查需求、进度、交付物和风险。\n决定：按批准版本执行，异常须登记并人工确认。\n行动：复核${task.title}的完成与交付证据。`,visibleRoles:["PM","MEMBER","QA","ADMIN"],requestKey:randomUUID(),actionItems:[{id:randomUUID(),text:`${people[task.ownerIndex].name}复核任务证据；已在模拟阶段关闭`,checked:true,taskId:task.id}]},actor(pm.id));}return {meetings:36,linkedClosedActionItems:36};
  });
  await check("297份历史个人周报与独立阅知",async()=>{
    for(let wi=0;wi<27;wi++){
      const day=new Date(Date.UTC(2026,2,30+wi*7));const label=day.toISOString().slice(0,10),phase=phases[Math.min(7,Math.floor(wi*8/27))];
      for(const person of people.slice(0,11)){
        let report=await weekly.createWeekly({week:label},actor(person.id));const sectionId=randomUUID();
        const sections=[{id:sectionId,projectId,summary:`${person.name}｜${phase[0]}｜本周按批准计划推进${person.skills}，核对相关任务与交付证据。此为历史合成补录，实际提交时间以系统为准。`,items:[{kind:"COMPLETED",text:`完成${phase[0]}范围内的${person.position}工作检查，记录版本及处理结论。`,declaredHours:wi===0||wi===26?24:40},{kind:"ONGOING",text:"核对依赖及阶段交付条件，保持需求与任务追溯一致。"},{kind:"RISK",text:person.name==="陆景行"&&wi===11?"本周计划休假，接口工作由技术负责人协调；申报工时为0。":"关注接口及验收依赖，出现偏差时向PM升级。"},{kind:"NEXT_WEEK",text:wi===26?"项目期结束，按移交清单处理维护事项。":`按计划准备下一阶段${person.skills}工作。` }]}];
        if(person.name==="陆景行"&&wi===11)sections[0].items[0].declaredHours=0;
        if(enhanced && wi===11){sections[0].summary+=" LIS第三方接口未交付；陆景行休假，周明哲接手。计划缓冲消耗与负责人交接已记录，接口联调暂受阻。";}
        if(enhanced && wi===15){sections[0].items[2].text="接口联调修订计划为7月14日，实际7月15日完成，偏差1天；PM跟踪测试窗口，不回写初始基线。";}
        report=await weekly.saveWeekly(report.id,{expectedVersion:report.rowVersion,sections},actor(person.id));
        if(enhanced && wi===12 && person.name==="沈亦辰"){manifest.draftWeekly={id:report.id,person:person.name,week:label,reason:"模拟漏报，PM要求补交；保留草稿，不伪造历史提醒或提交时间"};save();continue;}
        report=await weekly.submitWeekly(report.id,{expectedVersion:report.rowVersion},actor(person.id));
        const reviewer=person.role==="PM"?admin:pm;
        if(wi===0&&person.role==="PM")await denied(()=>weekly.reviewWeekly(report.id,{expectedVersion:report.rowVersion,sectionId,decision:"READ",reason:"本人不应自阅"},actor(person.id)),403);
        if(wi===3&&person.name==="何知远"){
          report=await weekly.reviewWeekly(report.id,{expectedVersion:report.rowVersion,sectionId,decision:"RETURNED",reason:"请补充本周缺陷复核与下周回归范围"},actor(reviewer.id));
          sections[0].summary+=" 修订：补充缺陷复核清单及下周回归范围。";
          report=await weekly.saveWeekly(report.id,{expectedVersion:report.rowVersion,sections},actor(person.id));report=await weekly.submitWeekly(report.id,{expectedVersion:report.rowVersion},actor(person.id));
        }
        await weekly.reviewWeekly(report.id,{expectedVersion:report.rowVersion,sectionId,decision:"READ",reason:"已阅知项目分区，事项按批准计划跟踪"},actor(reviewer.id));
        if(wi===0)writeFileSync(resolve(folder,`weekly-sample-${person.email.split("@")[0]}.json`),JSON.stringify(await weekly.exportWeekly(report.id,actor(person.id)),null,2));
      }
      console.log(`Weekly reports ${wi+1}/27 complete`);
      await document(`项目周报W${String(wi+1).padStart(2,"0")}`,`业务周起始：${label}。\n\n阶段：${phase[0]}。\n\n进展：按阶段核对任务、批准交付物及需求范围；本文件为历史合成项目管理记录。\n\n偏差与风险：持续关注接口依赖、人员休假与缺陷回归；具体状态以风险台账及系统记录为准。\n\n决策：变更须独立批准；未满足准入条件不得进入上线。\n\n下周：继续阶段计划，责任人按人员职责表执行。`,label<"2026-04-01"?"2026-04-01":label);
    }return {reports:297,weeks:27,revisionScenario:1,punctuality:"NOT_TESTED_RETROSPECTIVE"};
  });
  if(enhanced) await check("二期维护项目与当前工作现场",async()=>{
    let follow=await projects.createProject({name:"澄川市仁和医院电子病历二期优化与运维（执行中模拟）",description:`承接主项目${projectId}已明确延期的优化诉求及P2移交事项。1PM和10MEMBER；保持进行中、逾期及外部受阻现场。`,initializeStandardTasks:false},actor(pm.id));
    for(const person of people.slice(1))await setProjectMember(follow.id,{userId:person.id,active:true,expectedVersion:0},actor(pm.id));
    follow=await transitionProject(follow.id,"activate",{expectedRowVersion:follow.rowVersion,requestKey:randomUUID(),comment:"一期已进入结项，启动独立二期工作并保留遗留来源"},actor(pm.id));
    manifest.followUpProjectId=follow.id;save();
    const work=["移动端模板体验优化（一期延期诉求）","批量导出筛选体验优化（一期延期诉求）","P2-019 培训手册截图更新","P2-020 监控告警提示文案优化","LIS测试环境依赖协调","二期接口回归与发布准备"];
    const {hkToday}=load("modules/weekly-reports/policy.ts");const today=hkToday();
    const relative=offset=>new Date(new Date(`${today}T00:00:00Z`).getTime()+offset*86400000).toISOString().slice(0,10);
    const followRequirements=[];
    for(let i=0;i<work.length;i++){
      const intake=await reqs.createIntake(follow.id,{title:work[i],content:`来自一期项目${projectId}移交；当前范围明确，无P0/P1遗留。`,requester:"孟书宁（模拟信息科）",source:"CUSTOMER",sourceReference:`一期移交 ${projectId}；${i<2?intakes[31+i*5].id:"管理台账P2事项"}`,requestKey:randomUUID()},actor(pm.id));
      let row=await reqs.createRequirement(follow.id,{title:work[i],content:"仅处理已批准优化范围，按实际记录保留延期和外部阻塞。",acceptanceCriteria:"当前批准版本用例通过、任务签署、证据可下载；外部依赖未满足不得标记完成。",dueDate:relative(14),ownerId:people[1+i%10].id,priority:i<2?"COULD":"SHOULD",category:i===4?"INTERFACE":"FUNCTIONAL",riskLevel:"NORMAL",discoveryPhase:"二期启动",targetRelease:"2026.11",requestKey:randomUUID(),intakeId:intake.id},actor(pm.id));
      row=await reqs.actOnRequirement(follow.id,row.id,"submit",{expectedRowVersion:row.rowVersion,requestKey:randomUUID(),comment:"承接范围及验收条件明确"},actor(pm.id));
      row=await reqs.actOnRequirement(follow.id,row.id,"approve",{expectedRowVersion:row.rowVersion,requestKey:randomUUID(),comment:"独立确认二期范围，不扩大一期承诺",signaturePassword:password},actor(qa.id));followRequirements.push(row);
    }
    const currentTasks=[];
    for(let i=0;i<24;i++){
      const owner=people[1+i%10],ri=i%6,status=i<10?"IN_PROGRESS":i<16?"BLOCKED":"TODO";
      let row=await audit.createTask({...actor(pm.id),projectId:follow.id,title:`二期${String(i+1).padStart(2,"0")} ${work[ri]} · ${["分析","实施","回归","移交"][Math.floor(i/6)]}`,description:`责任人${owner.name}。${status==="BLOCKED"?"外部依赖：模拟医院测试环境或业务确认尚未就绪；PM协调，不认定为成员执行失败。":"按二期计划推进，保留实际处理结果。"}`,phase:"二期优化与运维",estimateHours:8+(i%4)*4,plannedStartDate:relative(-10),dueDate:relative([0,1,10,16,17].includes(i)?-3-i%3:3+i%7),assigneeId:owner.id,requirementId:followRequirements[ri].id});
      if(status!=="TODO")row=await audit.changeTaskStatus({...actor(owner.id),taskId:row.id,status:"IN_PROGRESS",expectedRowVersion:row.rowVersion});
      if(status==="BLOCKED")row=await audit.changeTaskStatus({...actor(owner.id),taskId:row.id,status:"BLOCKED",expectedRowVersion:row.rowVersion});
      currentTasks.push({id:row.id,assigneeId:owner.id,status:row.status,dueDate:row.dueDate});
    }
    await assets.createMeeting(follow.id,{title:"一期遗留移交及二期启动会",meetingDate:new Date().toISOString(),content:`一期${projectId}移交2项COULD延期诉求和2项低风险P2优化；无P0/P1遗留。外部依赖由PM协调；当前受阻不得虚报完成。`,visibleRoles:["PM","MEMBER","QA","ADMIN"],requestKey:randomUUID(),actionItems:[{id:randomUUID(),text:"周明哲跟进LIS测试环境并确认恢复日期",checked:false,taskId:currentTasks[10].id}]},actor(pm.id));
    await document("一期遗留移交与二期范围确认",`一期项目：${projectId}。二期项目：${follow.id}。\n\n2项未承诺的COULD诉求延期到二期；P2-019手册截图、P2-020告警文案为低风险优化，不影响一期已批准验收标准，无P0/P1遗留。各事项责任人及期限见二期6项批准需求、24项未完成任务。\n\n独立有条件验收功能未实现，本次使用正式范围内闭环加独立二期移交，不能声称系统支持有条件验收。\n\nDEF-001修复任务及失败复测、重开证据：${JSON.stringify(manifest.defectEvidence)}。台账其余条目为合成业务材料，不等同结构化缺陷模块。\n\n历史漏报保留草稿：${JSON.stringify(manifest.draftWeekly)}。历史迟报、定时提醒未回放。`,"2026-09-30");
    writeFileSync(resolve(folder,"follow-up-work.json"),JSON.stringify({projectId:follow.id,requirements:followRequirements.map(r=>({id:r.id,title:r.title})),tasks:currentTasks},null,2));
    const summary=await db.task.groupBy({by:["status"],where:{projectId:follow.id},_count:true});assert.equal(currentTasks.length,24);
    return {projectId:follow.id,requirements:6,tasks:24,statuses:summary,overdue:5,sourceMainProject:projectId};
  });
  await check("6份月报及风险问题缺陷台账",async()=>{
    const registers={risks:Array.from({length:12},(_,i)=>({id:`RSK-${i+1}`,title:["接口延期","资源冲突","需求范围扩大","迁移校验差异"][i%4],owner:people[1+i%10].name,impact:"可能影响阶段出口",mitigation:"人工评估、协调资源并执行回归",state:"模拟处置已记录",evidence:documentIndex[i%documentIndex.length].code})),issues:Array.from({length:18},(_,i)=>({id:`ISS-${i+1}`,title:`阶段协作问题${i+1}`,owner:people[1+i%10].name,dueDate:phases[Math.floor(i*8/18)][2],resolution:"责任人复核证据后关闭（合成下游事件）"})),defects:Array.from({length:20},(_,i)=>({id:`DEF-${i+1}`,requirement:requirements[i%30].number,description:`${topics[i%30]}模拟异常分支需修复`,severity:i<4?"P1":"P2",history:i===0?["发现","修复","回归失败","重开","修复","回归通过","关闭"]:["发现","修复","回归通过","关闭"],owner:people[3+i%5].name,syntheticDownstreamEvent:true}))};
    writeFileSync(resolve(folder,"management-registers.json"),JSON.stringify(registers,null,2));
    for(let m=4;m<=9;m++)await document(`${m}月项目月报`,`## 范围与成果\n\n按${m}月里程碑检查批准范围、WBS执行、交付物审批与需求验证；清单见系统及document-index.json。\n\n## 资源与偏差\n\n11人建设团队；容量按自然周登记，陆景行6月计划休假已列入资源计划。\n\n## 风险与决策\n\n风险12项、问题18项、缺陷20项均为合成业务事件台账；不冒充系统AI风险输出。关键缺陷必须关闭，后续维护另建项目。\n\n## 下月安排\n\n按下一阶段准入条件执行，9月完成归档。`,new Date(Date.UTC(2026,m,0)).toISOString().slice(0,10));
    await document("风险问题与缺陷综合台账",`\`management-registers.json\`保存完整明细。\n\n${JSON.stringify(registers,null,2)}`,"2026-09-18");return {monthlyReports:6,risks:12,issues:18,syntheticDefects:20,register:"management-registers.json"};
  });
  await check("验收驳回重提与独立归档",async()=>{
    await transition("submit-acceptance");await transition("reject-acceptance",qa,{comment:"首次结项复核要求重新确认交付索引与需求版本，保留本轮驳回记录"});
    await transition("submit-acceptance");await transition("qa-approve",qa);const archived=await transition("archive",admin);assert.equal(archived.status,"ARCHIVED");return {status:archived.status,rounds:2};
  });
  await check("归档后业务写入拒绝与只读导出",async()=>{
    await denied(()=>audit.createTask({...actor(pm.id),projectId,title:"归档后非法新增",phase:"验收与归档",estimateHours:1,dueDate:"2026-09-30"}),403);
    await denied(()=>db.$transaction(tx=>tx.task.update({where:{id:tasks[0].id},data:{title:"非法改写"}})));
    const {exportClosureReport}=load("modules/projects/closure-report.ts");
    for(const format of ["json","html"])writeFileSync(resolve(folder,`closure-report.${format}`),await exportClosureReport(projectId,format,actor(qa.id)));
    const revisions=await db.weeklyReportRevision.findMany();const {digest}=load("modules/weekly-reports/policy.ts");for(const r of revisions)assert.equal(digest(r.snapshot),r.sha256);
    const finalRequirements=await db.requirement.findMany({where:{projectId},include:{testCases:true,tasks:true}});
    for(const r of finalRequirements)for(const t of r.tasks)assert(r.completedAt>=t.completedAt,"需求实际关闭日期不能早于关联任务完成日期");
    writeFileSync(resolve(folder,"traceability.json"),JSON.stringify(finalRequirements,null,2));
    return {serviceAndSqlFreeze:true,weeklySnapshotHashes:revisions.length,chronologyVerified:true,exports:["closure-report.json","closure-report.html","traceability.json"]};
  });
  manifest.counts=await counts(db);
  manifest.sourceCountsAfter=await counts(originalDb);
  if (inPlace) {
    for(const model of originalModels){const before=originalRows[model]; const after=await originalDb[model].findMany({where:{id:{in:before.map(row=>row.id)}},orderBy:{id:"asc"}});assert.equal(hashRows(after),hashRows(before),`Existing ${model} rows must stay unchanged`);}
    manifest.existingRowsUnchanged=true;
  } else assert.deepEqual(manifest.sourceCountsBefore,manifest.sourceCountsAfter);
  manifest.status="COMPLETED_WITH_COVERAGE_GAPS";manifest.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({folder,database,projectId,status:manifest.status,counts:manifest.counts,checks:results.length}));
}catch(error){manifest.status="FAILED";manifest.error=error.message;manifest.finishedAt=new Date().toISOString();save();console.error(`Simulation stopped: ${error.message}; evidence: ${folder}`);process.exitCode=1;}
finally{await db?.$disconnect();await adminDb.$disconnect();await originalDb.$disconnect();}
