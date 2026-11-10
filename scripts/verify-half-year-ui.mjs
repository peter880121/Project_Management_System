import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { chromium, request } from "@playwright/test";
import { freeLocalPort } from "../tests/fixtures/free-port.mjs";

const root=resolve("output/half-year-simulation");
const folder=resolve(root,process.argv[2]??readdirSync(root).sort().at(-1));
assert(folder.startsWith(root+"\\"));
const manifest=JSON.parse(readFileSync(resolve(folder,"manifest.json"),"utf8"));
assert.equal(manifest.status,"COMPLETED_WITH_COVERAGE_GAPS","Complete the stateful rehearsal before browser checks");
const existingServer=process.argv.includes("--existing-server=4000");
if(existingServer){assert.equal(manifest.inPlace,true);assert.equal(manifest.database,new URL(process.env.DATABASE_URL).pathname.slice(1));}
else assert.match(manifest.database,/^medpm_sim_202604_\d{13}_[a-f0-9]{6}$/);
const credentials=JSON.parse(readFileSync(resolve(".maintenance",`half-year-${basename(folder)}`,"credentials.json"),"utf8"));
const target=new URL(process.env.DATABASE_URL);target.pathname=`/${manifest.database}`;
const db=new PrismaClient({datasources:{db:{url:target.toString()}}});
const port=existingServer?4000:await freeLocalPort(),baseURL=`http://127.0.0.1:${port}`;
const dist=`.next/half-year-ui-${Date.now()}`;
const originalTypes=readFileSync("next-env.d.ts","utf8");
let app,browser;const clients=[],pageErrors=[],httpErrors=[],checks=[];let serverLog="";
const screenshotFolder=resolve(folder,"screenshots");mkdirSync(screenshotFolder,{recursive:true});
const output={startedAt:new Date().toISOString(),database:manifest.database,projectId:manifest.projectId,status:"RUNNING",checks,pageErrors,httpErrors};
if(existsSync(resolve(folder,"browser-verification.json"))){
  const history=resolve(folder,"browser-attempts");mkdirSync(history,{recursive:true});
  copyFileSync(resolve(folder,"browser-verification.json"),resolve(history,`${Date.now()}.json`));
}
const save=()=>writeFileSync(resolve(folder,"browser-verification.json"),JSON.stringify(output,null,2));save();
async function count(){return{projects:await db.project.count(),tasks:await db.task.count(),requirements:await db.requirement.count(),deliverables:await db.deliverable.count(),weeklyReports:await db.weeklyReport.count()};}
try{
  output.before=await count();
  if(!existingServer)app=spawn(process.execPath,["tests/fixtures/next-dev-server.mjs"],{env:{...process.env,DATABASE_URL:target.toString(),NEXT_DIST_DIR:dist,E2E_APP_PORT:String(port),NODE_OPTIONS:process.env.NODE_OPTIONS||"--max-old-space-size=6144"},stdio:["ignore","pipe","pipe"],windowsHide:true});
  const collect=chunk=>{serverLog=(serverLog+chunk.toString()).slice(-12000);};app?.stdout.on("data",collect);app?.stderr.on("data",collect);
  let ready=false;
  for(let i=0;i<180;i++){if(app&&app.exitCode!==null)throw new Error("Owned test server exited");try{if((await fetch(baseURL)).ok){ready=true;break;}}catch{}await delay(500);}
  assert(ready,"Owned test server readiness timeout");
  for(const account of credentials.accounts){
    const client=await request.newContext({baseURL,timeout:90000,userAgent:"Half-year simulation browser verification"});clients.push({client,account});
    const response=await client.post("/api/auth/login",{data:{email:account.email,password:credentials.password}});assert.equal(response.status(),200,`${account.name} login`);
    const me=await client.get("/api/auth/me");assert.equal(me.status(),200);const identity=await me.json();assert(JSON.stringify(identity).includes(account.name));
  }
  checks.push({name:"13名实名账号真实HTTP登录及身份",status:"PASSED",accounts:13});save();
  // Warm route once, then measure simultaneous reads using 11 independent sessions.
  const path=`/api/projects/${manifest.projectId}/lifecycle`;
  assert.equal((await clients[0].client.get(path)).status(),200);
  const responses=await Promise.all(clients.filter(({account})=>["PM","MEMBER"].includes(account.role)).map(async({client,account})=>{const start=Date.now(),response=await client.get(path);assert.equal(response.status(),200);return{name:account.name,status:response.status(),durationMs:Date.now()-start};}));
  checks.push({name:"1PM和10MEMBER并发读取同一归档项目",status:"PASSED",responses});save();
  const pm=clients.find(c=>c.account.role==="PM"),qa=clients.find(c=>c.account.role==="QA"),member=clients.find(c=>c.account.role==="MEMBER");
  const documents=JSON.parse(readFileSync(resolve(folder,"document-index.json"),"utf8"));
  const first=documents[0];const download=await qa.client.get(`/api/documents/${first.documentId}/download`);assert.equal(download.status(),200);
  const {createHash}=await import("node:crypto");assert.equal(createHash("sha256").update(await download.body()).digest("hex"),first.sha256);
  const report=await qa.client.get(`/api/projects/${manifest.projectId}/report?format=json`);assert.equal(report.status(),200);assert.equal((await report.json()).project.status,"ARCHIVED");
  const task=await db.task.findFirstOrThrow({where:{projectId:manifest.projectId}});
  const blocked=await member.client.patch(`/api/tasks/${task.id}`,{data:{status:"IN_PROGRESS",expectedRowVersion:task.rowVersion}});assert.equal(blocked.status(),403);
  checks.push({name:"真实HTTP下载哈希、报告导出及归档写入拦截",status:"PASSED",blockedStatus:403});save();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({storageState:await pm.client.storageState(),viewport:{width:1600,height:1050}});
  const page=await context.newPage();page.setDefaultTimeout(90000);
  page.on("pageerror",error=>pageErrors.push(error.message));page.on("response",response=>{if(response.url().startsWith(baseURL)&&response.status()>=400)httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
  for(const route of ["board","planning","requirements","deliverables","meetings","acceptance","members"]){
    const response=await page.goto(`${baseURL}/projects/${manifest.projectId}/${route}`,{timeout:90000,waitUntil:"networkidle"});assert.equal(response.status(),200);
    if(route==="board")await page.getByRole("region",{name:"任务看板",exact:true}).waitFor();
    await page.screenshot({path:resolve(screenshotFolder,`${route}.png`),fullPage:true});
    const marker={board:"澄川市仁和医院",planning:"澄川市仁和医院",requirements:"需求管理",deliverables:"交付物",meetings:"会议",acceptance:"归档",members:"成员"}[route];
    assert((await page.locator("body").innerText()).includes(marker),`Expected ${route} page content`);
    checks.push({name:`PM浏览器页面 ${route}`,status:"PASSED"});save();console.log(`PASS browser ${route}`);
  }
  await page.goto(`${baseURL}/weekly-reports?week=2026-04-06`,{timeout:90000,waitUntil:"networkidle"});assert((await page.locator("body").innerText()).includes("个人周报"));await page.screenshot({path:resolve(screenshotFolder,"weekly-reports.png"),fullPage:true});
  checks.push({name:"个人周报浏览器入口",status:"PASSED"});
  if(manifest.followUpProjectId){
    const accounts=JSON.parse(readFileSync(resolve(folder,"personnel.json"),"utf8"));
    const person=accounts.find(p=>p.name==="林若涵");
    const query=`dimension=tasks&personId=${person.id}&projectId=${manifest.followUpProjectId}`;
    const insight=await pm.client.get(`/api/dashboard/insights?${query}`);assert.equal(insight.status(),200);const data=await insight.json();assert.equal(data.total,3);assert.equal(data.personTasks.inProgress,1);assert.equal(data.personTasks.overdue,2);assert.equal(data.personTasks.blocked,1);
    const unrelated=await member.client.get(`/api/dashboard/insights?${query}`);assert.equal(unrelated.status(),403);
    await page.goto(`${baseURL}/dashboard?tab=tasks&personId=${person.id}&projectId=${manifest.followUpProjectId}`,{waitUntil:"networkidle",timeout:90000});
    await page.getByRole("heading",{name:"当前待跟进任务",exact:true}).waitFor();assert.equal(await page.locator("table tbody tr").count(),3);
    const history=page.locator("details").filter({has:page.locator("summary",{hasText:"历史办理记录"})});assert.equal(await history.getAttribute("open"),null);
    await page.screenshot({path:resolve(screenshotFolder,"person-current-tasks.png"),fullPage:true});
    await page.goto(`${baseURL}/projects/${manifest.followUpProjectId}/board`,{waitUntil:"networkidle",timeout:90000});await page.getByRole("region",{name:"任务看板",exact:true}).waitFor();await page.screenshot({path:resolve(screenshotFolder,"follow-up-board.png"),fullPage:true});
    checks.push({name:"二期当前任务、逾期受阻统计、历史折叠及成员越权拒绝",status:"PASSED",projectId:manifest.followUpProjectId,person:person.name,tasks:3,overdue:2});save();
  }
  assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);output.after=await count();assert.deepEqual(output.before,output.after);output.status="PASSED";
}catch(error){output.status="FAILED";output.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
  await browser?.close();
  for(const {client}of clients){try{await client.post("/api/auth/logout");}catch{}await client.dispose();}
  if(app&&app.exitCode===null){const stopped=once(app,"exit");app.kill();await stopped;}
  writeFileSync(resolve(folder,"browser-server.log"),serverLog);
  if(!existingServer){const config=JSON.parse(readFileSync("tsconfig.json","utf8"));config.include=config.include.filter(entry=>!entry.startsWith(`${dist}/`));writeFileSync("tsconfig.json",`${JSON.stringify(config,null,2)}\n`);}
  if(readFileSync("next-env.d.ts","utf8").includes(dist))writeFileSync("next-env.d.ts",originalTypes);
  await db.$disconnect();output.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:output.status,checks:checks.length,folder}));
}
