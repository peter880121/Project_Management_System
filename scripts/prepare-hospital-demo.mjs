import "dotenv/config";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { typescriptRequire } from "./lib/load-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !["--apply", "--skip-index", "--no-switch", "--with-standard-projects"].includes(arg))) throw new Error("Supported options: --apply --skip-index --no-switch --with-standard-projects");
if (process.env.NODE_ENV === "production") throw new Error("Demo preparation is development-only");
const sourceUrl = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname) || !/^medpm(?:_demo_[a-zA-Z0-9_]+)?$/.test(sourceUrl.pathname.slice(1))) throw new Error("Only an allowlisted local medpm development database may be used");
const require = typescriptRequire(root);
const { taskPlanData } = require(resolve(root, "src/modules/tasks/plan.ts"));
const { STANDARD_PROJECT_TASKS } = require(resolve(root, "src/modules/projects/templates.ts"));
const assets = JSON.parse(readFileSync("prisma/demo-assets/hospital/documents.json", "utf8"));
const emails = ["admin@medpm.local", "pm@medpm.local", "qa@medpm.local", "member@medpm.local"];
const expectedRoles = ["ADMIN", "PM", "QA", "MEMBER"];
const systemId = "00000000-0000-4000-8000-0000000000f0";
const projectName = "XX市第一人民医院EMR系统交付";
const standardProjectNames = args.has("--with-standard-projects") ? ["XX市人民医院检验系统建设项目", "中医院电子病历建设项目"] : [];
const source = new PrismaClient({ datasources: { db: { url: sourceUrl.toString() } } });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const day = new Date(); day.setUTCHours(0, 0, 0, 0);
function businessDay(date, offset) { const result = new Date(date); const step = Math.sign(offset); for (let n = 0; n < Math.abs(offset);) { result.setUTCDate(result.getUTCDate() + step); if (![0, 6].includes(result.getUTCDay())) n++; } while ([0, 6].includes(result.getUTCDay())) result.setUTCDate(result.getUTCDate() + 1); return result; }
let admin, target, sharedPrisma, vectorClient;
let stage = "preflight";
try {
  const users = await source.user.findMany({ where: { email: { in: emails }, isSystem: false }, select: { id: true, email: true, name: true, role: true, passwordHash: true, createdAt: true } });
  const ordered = emails.map((email, index) => {
    const user = users.find(u => u.email === email);
    if (!user?.passwordHash || user.role !== expectedRoles[index]) throw new Error("Required base account is missing or has an unexpected role");
    return user;
  });
  const before = { projects: await source.project.count(), tasks: await source.task.count(), audits: await source.auditLog.count(), users: await source.user.count() };
  const files = assets.map(asset => {
    const file = `output/pdf/hospital/${asset.key}.pdf`;
    if (!existsSync(file)) throw new Error("Missing checked-in demo PDF");
    const bytes = readFileSync(file); if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid demo PDF");
    return { ...asset, bytes, sha256: sha(bytes) };
  });
  console.log(JSON.stringify({ mode: args.has("--apply") ? "APPLY" : "PREVIEW_ONLY", sourceDatabase: sourceUrl.pathname.slice(1), sourceCounts: before, project: projectName, standardProjectNames, baseAccounts: ordered.map(({ email, role }) => ({ email, role })), dataset: { projects: 1 + standardProjectNames.length, tasks: 14 * (1 + standardProjectNames.length), done: 6, inProgress: 1, todo: 7 + 14 * standardProjectNames.length, approvedDeliverables: 3, meetings: 1, actionItems: 3 }, preservesSourceAudits: true, copiesExistingPasswordHashes: true, indexesRealVectors: !args.has("--skip-index") }, null, 2));
  if (args.has("--apply")) {
    if (!process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local MySQL administrator credentials required");
    const username = decodeURIComponent(sourceUrl.username);
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error("Unsupported local database account");
    const environment = readFileSync(".env", "utf8");
    const urlLine = /^DATABASE_URL=(.*)$/m.exec(environment);
    if (!urlLine || urlLine[1].trim().replace(/^['"]|['"]$/g, "") !== sourceUrl.toString()) throw new Error("Process DATABASE_URL differs from .env; refusing to switch");
    const name = `medpm_demo_hospital_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(4).toString("hex")}`;
    if (!/^medpm_demo_hospital_\d{8}_[a-f0-9]{8}$/.test(name)) throw new Error("Invalid target schema");
    const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${name}`;
    const adminUrl = new URL(sourceUrl); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
    admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    const accounts = await admin.$queryRaw`SELECT Host host FROM mysql.user WHERE User=${username}`;
    if (!accounts.length || accounts.some(row => !/^[a-zA-Z0-9_.%:-]+$/.test(row.host))) throw new Error("Unexpected local database grants");
    const backup = `.env.before-demo-${name}`; copyFileSync(".env", backup);
    stage = "create-isolated-schema";
    // Only validated identifiers are interpolated. Source schema is never a mutation target.
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    for (const { host } of accounts) await admin.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'${host}'`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: targetUrl.toString() }, stdio: "pipe", windowsHide: true });
    target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
    process.env.DATABASE_URL = targetUrl.toString();
    const [adminUser, pm, qa, member] = ordered;
    const projectId = randomUUID(); const now = new Date(); const createdAt = businessDay(day, -21);
    const { documentStorage } = require(resolve(root, "src/modules/documents/storage.ts"));
    const uploaded = [];
    stage = "upload-and-verify-pdfs";
    for (const file of files) {
      const key = `hospital-demo/${projectId}/${randomUUID()}/${file.key}.pdf`;
      await documentStorage.put(key, file.bytes, file.sha256);
      if (sha(await documentStorage.get(key)) !== file.sha256) throw new Error("Uploaded PDF hash mismatch");
      uploaded.push({ ...file, key, documentId: randomUUID(), deliverableId: randomUUID() });
    }
    stage = "seed-audited-business-data";
    await target.$transaction(async tx => {
      for (const user of ordered) await tx.user.create({ data: { ...user, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null, lastLoginAt: null } });
      await tx.user.create({ data: { id: systemId, email: "auth-service@medpm.local", name: "MedPM authentication service", role: "MEMBER", status: "DISABLED", isSystem: true } });
      const audit = (actorId, action, entityType, entityId, after, time = now, prior = undefined) => tx.auditLog.create({ data: { actorId, projectId, action, entityType, entityId, ...(prior ? { before: prior } : {}), after: { ...after, source: "SYNTHETIC_HOSPITAL_DEMO" }, ip: "127.0.0.1", userAgent: "MedPM synthetic hospital demo preparation", createdAt: time } });
      await tx.project.create({ data: { id: projectId, name: projectName, description: "合成医疗交付演示项目：覆盖需求、实施、验证、上线与验收。所有资料均为虚构，不包含真实医院或患者信息。", ownerId: pm.id, status: "ACTIVE", createdAt } });
      await audit(pm.id, "PROJECT_CREATED", "Project", projectId, { name: projectName, status: "ACTIVE", ownerId: pm.id }, createdAt);
      for (const user of ordered) await audit(adminUser.id, "DEMO_ACCOUNT_IMPORTED", "User", user.id, { email: user.email, role: user.role, status: "ACTIVE", existingPasswordPreserved: true }, createdAt);
      for (const user of ordered) { const row = await tx.projectMember.create({ data: { projectId, userId: user.id } }); await audit(adminUser.id, "PROJECT_MEMBER_UPDATED", "ProjectMember", row.id, { userId: user.id, active: true }, createdAt); }
      const reqs = [];
      for (const title of ["EMR病历模板与质控", "EMR接口与异常处理", "EMR权限审计与交付追溯"]) {
        const requirement = await tx.requirement.create({ data: { projectId, title, content: `合成演示需求：${title}。详见《需求规格说明书》；不含患者数据。`, status: "APPROVED", createdAt } }); reqs.push(requirement);
        await audit(pm.id, "REQUIREMENT_CREATED", "Requirement", requirement.id, { title, version: 1, status: "APPROVED" }, createdAt);
        const test = await tx.testCase.create({ data: { requirementId: requirement.id, title: `${title}的正常、异常及权限场景验证`, status: "NOT_RUN", reviewedRequirementVersion: 1, requirementReviewedById: qa.id, requirementReviewedAt: createdAt } });
        await audit(qa.id, "TEST_CASE_CREATED", "TestCase", test.id, { requirementId: requirement.id, status: "NOT_RUN" }, createdAt);
      }
      const taskIds = new Map(); let cursor = businessDay(day, -18);
      const durations = [1, 2, 5, 3, 2, 5];
      const reasons = ["确认会议已完成", "确认计划编制完成", "确认需求与方案评审通过", "确认需求与方案评审通过", "确认任务已完成", "确认配置与联调完成"];
      for (const [index, item] of STANDARD_PROJECT_TASKS.entries()) {
        const id = randomUUID(); taskIds.set(item.key, id);
        const duration = durations[index] ?? Math.max(1, Math.ceil(item.estimateHours / 8));
        const start = cursor; const end = businessDay(start, duration - 1); cursor = businessDay(end, 1);
        const assigneeId = index < 4 ? pm.id : member.id;
        const completedAt = index < 6 ? new Date(`${end.toISOString().slice(0, 10)}T00:00:00.000Z`) : null;
        const plan = taskPlanData({ phase: item.phase, estimateHours: item.estimateHours, dueDate: end.toISOString().slice(0, 10), plannedStartDate: start.toISOString().slice(0, 10) }, "合成EMR交付工作包。按项目基线执行，关键记录均保留审计；无真实患者数据。");
        const task = await tx.task.create({ data: { ...plan, completionRoundId: randomUUID(), signatureEvidenceVersion: 2, id, projectId, title: item.title, status: index < 6 ? "DONE" : index === 6 ? "IN_PROGRESS" : "TODO", assigneeId, requiresDeliverable: files.some(file => file.taskKey === item.key) || ["sit", "uat", "csv", "go-live", "handover"].includes(item.key), actualHours: index < 6 ? item.estimateHours : null, completedAt, scheduleVersion: 1, requirementId: reqs[index % 3].id, reviewedRequirementVersion: 1, requirementReviewedById: pm.id, requirementReviewedAt: createdAt, createdAt } });
        await audit(pm.id, "TASK_CREATED", "Task", id, { title: item.title, status: "TODO", assigneeId }, createdAt);
        await audit(pm.id, "TASK_SCHEDULE_UPDATED", "Task", id, { plannedStartDate: start.toISOString(), dueDate: end.toISOString(), scheduleVersion: 1 }, createdAt);
        if (item.dependsOn) { const dep = await tx.taskDependency.create({ data: { taskId: id, dependsOnTaskId: taskIds.get(item.dependsOn) } }); await audit(pm.id, "TASK_DEPENDENCY_CREATED", "TaskDependency", dep.id, { taskId: id, dependsOnTaskId: dep.dependsOnTaskId }, createdAt); }
        // Synthetic historical evidence is explicitly marked; never presented as a live bcrypt login.
        if (completedAt) await audit(assigneeId, "TASK_SIGNED_AND_COMPLETED", "Task", id, { status: "DONE", actualHours: task.actualHours.toString(), completedAt: completedAt.toISOString(), completionRoundId: task.completionRoundId, signatureReason: reasons[index] }, completedAt, { status: "IN_PROGRESS" });
        else if (index === 6) await audit(assigneeId, "TASK_STATUS_CHANGED", "Task", id, { status: "IN_PROGRESS" }, now, { status: "TODO" });
      }
      for (const file of uploaded) {
        const taskId = taskIds.get(file.taskKey); const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
        const reviewedAt = new Date(task.completedAt.getTime() - 60000); const submittedAt = new Date(reviewedAt.getTime() - 60000);
        const markdown = `# ${file.name}\n\n合成演示资料，不含真实患者信息。\n\n${file.sections.map(([h, b]) => `## ${h}\n${b}`).join("\n\n")}`;
        await tx.document.create({ data: { id: file.documentId, projectId, filename: `${file.name}.pdf`, mediaType: "application/pdf", minioKey: file.key, uploadedById: pm.id, fileSize: file.bytes.length, sha256: file.sha256, storageStatus: "AVAILABLE", documentType: "DELIVERABLE", uploadedAt: submittedAt, createdAt: submittedAt, parseStatus: "SUCCEEDED", parseVersion: 1, parsedVersion: 1, parsedText: markdown, parsedAt: reviewedAt } });
        const job = await tx.documentParseJob.create({ data: { documentId: file.documentId, version: 1, requestedById: pm.id, requestKey: randomUUID(), status: "SUCCEEDED", phase: "COMPLETED", provider: "synthetic-authored-source", modelVersion: "authored-text-v1", sourceSha256: file.sha256, sourceFilename: `${file.name}.pdf`, sourceSize: file.bytes.length, deadlineAt: now, markdown, blocks: [{ page: 1, type: "text", text: markdown }], completedAt: reviewedAt } });
        await tx.deliverable.create({ data: { id: file.deliverableId, seriesId: file.deliverableId, projectId, taskId, documentId: file.documentId, name: file.name, status: "APPROVED", createdById: pm.id, submittedById: pm.id, submittedAt, reviewedById: qa.id, reviewedAt, reviewComment: "合成演示：独立 QA 已核对版本、范围和交付证据，批准作为演示基线。", rowVersion: 3, createdAt: submittedAt } });
        await audit(pm.id, "DOCUMENT_UPLOADED", "Document", file.documentId, { sha256: file.sha256, fileSize: file.bytes.length }, submittedAt);
        await audit(pm.id, "DELIVERABLE_CREATED", "Deliverable", file.deliverableId, { documentId: file.documentId, taskId, version: 1 }, submittedAt);
        await audit(pm.id, "DELIVERABLE_SUBMITTED", "Deliverable", file.deliverableId, { status: "PENDING_REVIEW" }, submittedAt);
        await audit(qa.id, "DELIVERABLE_REVIEWED", "Deliverable", file.deliverableId, { status: "APPROVED", version: 1, documentId: file.documentId, sha256: file.sha256, reviewerId: qa.id }, reviewedAt);
        await audit(pm.id, "DEMO_AUTHORED_TEXT_PREPARED", "DocumentParseJob", job.id, { documentId: file.documentId, provider: "synthetic-authored-source", sourceSha256: file.sha256, markdownSha256: sha(markdown), note: "从同源合成文档导入文本；未冒充 MinerU 云端解析" }, reviewedAt);
      }
      const meeting = await tx.meetingRecord.create({ data: { projectId, title: "EMR项目周例会：SIT准入与行动项确认", meetingDate: new Date(day.getTime() + 3600000), createdById: pm.id, requestKey: randomUUID(), status: "FINALIZED", content: "# 合成EMR项目周例会\n\n## 进展\n需求基线、蓝图、环境与接口联调工作包已完成，相关交付物由独立 QA 审批。当前进入 SIT，UAT、CSV、培训及切换按后续排期推进。\n\n## 决议\n接口验证只使用合成报文；上线前必须完成验证、培训和切换回退演练。AI 仅提供建议，不自动创建任务或审批。\n\n## Action Items\n- 工程师补齐接口异常场景测试清单。\n- 项目经理组织护理模板业务走查。\n- QA复核CSV验证方案与证据目录。\n\n请在下方逐项确认并转为任务；本纪要不含真实患者信息。", actionItems: [
        { id: randomUUID(), text: "补齐EMR接口重复消息与超时恢复的SIT测试清单", checked: false, suggestedAssigneeName: member.name, suggestedAssigneeId: member.id, expectedDueDate: businessDay(day, 2).toISOString().slice(0, 10) },
        { id: randomUUID(), text: "组织护理病历模板业务走查并确认UAT代表", checked: false, suggestedAssigneeName: pm.name, suggestedAssigneeId: pm.id, expectedDueDate: businessDay(day, 3).toISOString().slice(0, 10) },
        { id: randomUUID(), text: "协调QA复核CSV验证方案与证据目录", checked: false, suggestedAssigneeName: pm.name, suggestedAssigneeId: pm.id, expectedDueDate: businessDay(day, 4).toISOString().slice(0, 10) },
      ] } });
      await audit(pm.id, "MEETING_CREATED", "MeetingRecord", meeting.id, { title: meeting.title, actionItemCount: 3, contentSha256: sha(meeting.content) });
    }, { timeout: 30000 });
    sharedPrisma = require(resolve(root, "src/lib/prisma.ts")).prisma;
    stage = "create-standard-planning-projects";
    if (standardProjectNames.length) {
      const { createProject } = require(resolve(root, "src/modules/projects/services.ts"));
      for (const name of standardProjectNames) await createProject({ name, description: "干净全流程测试基线：仅含标准医疗 WBS，等待人员配置、排期和实际执行；全部为合成数据。", initializeStandardTasks: true }, { actorId: pm.id, userAgent: "MedPM synthetic baseline preparation" });
    }
    stage = "build-and-index-assets";
    const worker = require(resolve(root, "src/modules/documents/rag-worker.ts"));
    for (let i = 0; i < 10 && await worker.buildDocumentChunksTick(); i++);
    if (!args.has("--skip-index")) {
      for (let i = 0; i < 30 && await worker.syncDocumentVectorTick(); i++);
      vectorClient = require(resolve(root, "src/modules/vector/client.ts")).getMilvusClient();
      if (await target.documentChunk.count({ where: { vectorStatus: { not: "SYNCED" } } })) throw new Error("Real vector synchronization did not complete; source remains active");
    }
    stage = "verify-and-switch";
    const { readCounts } = require(resolve(root, "src/modules/projects/acceptance-check/repository.ts"));
    const rules = await target.$transaction(tx => readCounts(tx, projectId));
    const counts = { projects: await target.project.count(), users: await target.user.count({ where: { isSystem: false } }), tasks: await target.task.count(), done: await target.task.count({ where: { status: "DONE" } }), approvedDeliverables: await target.deliverable.count({ where: { status: "APPROVED" } }), meetings: await target.meetingRecord.count(), syncFailures: await target.syncFailure.count(), sessions: await target.session.count(), chunks: await target.documentChunk.count(), syncedChunks: await target.documentChunk.count({ where: { vectorStatus: "SYNCED" } }) };
    if (counts.projects !== 1 + standardProjectNames.length || counts.users !== 4 || counts.tasks !== 14 * (1 + standardProjectNames.length) || counts.done !== 6 || counts.approvedDeliverables !== 3 || counts.meetings !== 1 || counts.syncFailures || counts.sessions || rules.MISSING_SIGNATURES || rules.UNLINKED_ACTION_ITEMS !== 3) throw new Error("Demo consistency verification failed");
    const projectList = await target.project.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } });
    if (await source.project.count({ where: { id: { in: projectList.map(project => project.id) } } })) throw new Error("Project identifiers must isolate old vector and object assets");
    if (await target.task.count({ where: { signatureEvidenceVersion: { not: 2 } } })) throw new Error("Demo tasks require strict signature evidence");
    const copied = await target.user.findMany({ where: { email: { in: emails } }, select: { id: true, passwordHash: true } });
    if (ordered.some(user => !copied.some(copy => copy.id === user.id && copy.passwordHash === user.passwordHash))) throw new Error("Account preservation failed");
    if (await source.auditLog.count() !== before.audits || readFileSync(".env", "utf8") !== environment) throw new Error("Source or environment changed during preparation; target retained without switching");
    const manifest = { sourceDatabase: sourceUrl.pathname.slice(1), demoDatabase: name, projectId, projectName, projectList, projectUrl: `http://localhost:4000/projects/${projectId}/board`, before, counts, rules, backup, previousPasswordsPreserved: true, switched: !args.has("--no-switch"), indexMode: args.has("--skip-index") ? "PENDING_REAL_WORKER" : "REAL_MILVUS", preparedAt: now.toISOString() };
    mkdirSync("test-results/hospital-demo", { recursive: true }); writeFileSync(`test-results/hospital-demo/${name}.json`, JSON.stringify(manifest, null, 2));
    if (!args.has("--no-switch")) { const temporary = `.env.demo-next-${randomBytes(4).toString("hex")}`; writeFileSync(temporary, environment.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${targetUrl.toString()}`), { mode: 0o600 }); renameSync(temporary, ".env"); }
    if (!args.has("--no-switch")) { mkdirSync("output/environment", { recursive: true }); writeFileSync("output/environment/current.json", JSON.stringify(manifest, null, 2)); }
    console.log(JSON.stringify(manifest, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ stage, error: "Hospital demo preparation failed; source rows, objects and audit logs were not deleted. Inspect the stage and retained environment backup.", reason: error instanceof Error && !/password|mysql:|https?:/i.test(error.message) ? error.message.slice(0, 180) : "Dependency or permission failure" }));
  process.exitCode = 1;
} finally {
  if (vectorClient) await vectorClient.closeConnection();
  await Promise.all([source.$disconnect(), target?.$disconnect(), admin?.$disconnect(), sharedPrisma?.$disconnect()]);
}
