import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const folder = resolve("output/half-year-simulation", process.argv[2] || "");
assert.equal(basename(folder), process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
assert.equal(manifest.inPlace, true);
assert.equal(manifest.database, new URL(process.env.DATABASE_URL).pathname.slice(1));
assert.equal(manifest.status, "COMPLETED_WITH_COVERAGE_GAPS");
const people = JSON.parse(readFileSync(resolve(folder, "personnel.json"), "utf8"));
const old = JSON.parse(readFileSync(resolve(".maintenance", `half-year-${basename(folder)}`, "original-rows.json"), "utf8"));
const db = new PrismaClient();
const hash = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  const projects = await db.project.findMany({where:{id:{in:[manifest.projectId,manifest.followUpProjectId]}},select:{id:true,name:true,status:true}});
  assert.equal(projects.find(p=>p.id===manifest.projectId)?.status,"ARCHIVED");
  assert.equal(projects.find(p=>p.id===manifest.followUpProjectId)?.status,"ACTIVE");
  for (const [model, before] of Object.entries(old)) {
    const after = await db[model].findMany({where:{id:{in:before.map(r=>r.id)}},orderBy:{id:"asc"}});
    assert.equal(hash(after),hash(before),`Existing ${model} must remain unchanged`);
  }
  const mainTasks = await db.task.findMany({where:{projectId:manifest.projectId}});
  const openTasks = await db.task.findMany({where:{projectId:manifest.followUpProjectId}});
  assert.equal(mainTasks.length,121);assert(mainTasks.every(t=>t.status==="DONE"));
  assert.equal(openTasks.length,24);
  for(const [status,expected]of Object.entries({IN_PROGRESS:10,BLOCKED:6,TODO:8}))assert.equal(openTasks.filter(t=>t.status===status).length,expected);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  assert.equal(openTasks.filter(t=>t.dueDate.toISOString().slice(0,10)<today).length,5);
  const scope={projectId:{in:projects.map(p=>p.id)}};
  assert.equal(await db.requirement.count({where:{projectId:manifest.projectId,workflowState:"CLOSED"}}),30);
  assert.equal(await db.requirement.count({where:{projectId:manifest.followUpProjectId,workflowState:"APPROVED"}}),6);
  const documents=await db.deliverable.findMany({where:scope,select:{id:true,status:true,version:true}});
  assert.equal(documents.filter(d=>d.status==="APPROVED").length,66);
  assert.equal(documents.filter(d=>d.status==="REJECTED").length,1);
  assert(documents.some(d=>d.version===2&&d.status==="APPROVED"));
  const reports=await db.weeklyReport.findMany({where:{authorId:{in:people.map(p=>p.id)}},select:{id:true,state:true}});
  assert.equal(reports.length,297);assert.equal(reports.filter(r=>r.state==="DRAFT").length,1);
  const reportIds=reports.map(r=>r.id);
  assert.equal(await db.weeklyReportRevision.count({where:{reportId:{in:reportIds}}}),297);
  const audits=await db.auditLog.findMany({where:scope,select:{id:true,action:true,ip:true,userAgent:true}});
  assert(audits.every(a=>a.ip&&a.userAgent));
  assert(audits.some(a=>a.action==="TASK_REOPENED"));
  const failedExecutions=await db.testExecution.count({where:{projectId:manifest.projectId,result:"FAILED"}});assert.equal(failedExecutions,2);
  const baseline=JSON.parse(readFileSync(resolve(folder,"initial-task-plan.json"),"utf8"));
  const handoff=manifest.results.find(r=>r.name==="初始计划固化及接口延期交接").evidence;
  const original=baseline.find(t=>t.id===handoff.handoffTaskId),actual=mainTasks.find(t=>t.id===original.id);
  assert.equal(original.dueDate.slice(0,10),"2026-07-10");assert.equal(actual.dueDate.toISOString().slice(0,10),"2026-07-14");assert.equal(actual.completedAt.toISOString().slice(0,10),"2026-07-15");assert.notEqual(original.assigneeId,actual.assigneeId);
  const result={status:"PASSED",verifiedAt:new Date().toISOString(),database:manifest.database,existingCoreRowsUnchanged:true,projects,mainTasks:121,followUpTasks:24,overdueTasks:5,requirements:36,approvedDocuments:66,rejectedDocumentVersions:1,weeklyReports:297,submittedReports:296,unsubmittedDrafts:1,submissionSnapshots:297,failedTestHistory:failedExecutions,realisticHandoffAndDelayVerified:true,scopeAuditRecords:audits.length,pm:{name:people[0].name,email:people[0].email}};
  writeFileSync(resolve(folder,"integrity-verification.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await db.$disconnect();}
