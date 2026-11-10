import { createServer } from "node:http";

/** Protocol fixture only: real LangChain HTTP streaming, no external model or real patient data. */
export async function startAiStreamFixture() {
  let mode = "normal"; let attempts = 0; let cancelled = 0; let started = 0; const waiting = new Set();
  let searches = 0; let searchCancelled = 0; let lastSearchQuery = ""; let lastSearchKeys = []; let lastWebInput = ""; let generalStarted = 0; let webAnswerStarted = 0;
  const stats = () => ({ started, cancelled, searches, searchCancelled, lastSearchQuery, lastSearchKeys, lastWebInput, generalStarted, webAnswerStarted });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/__fixture/control") {
      const nextMode = url.searchParams.get("mode") || "normal";
      if (nextMode !== mode && nextMode !== "release") attempts = 0;
      mode = nextMode;
      if (mode === "release") { for (const release of waiting) release(); waiting.clear(); }
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(stats())); return;
    }
    if (url.pathname === "/__fixture/stats") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(stats())); return; }
    if (url.pathname === "/search") {
      let body = ""; for await (const bytes of request) body += bytes; const data = JSON.parse(body); searches++; lastSearchQuery = data.query; lastSearchKeys = Object.keys(data);
      let finished = false; let release; response.on("close", () => { if (!finished) searchCancelled++; release?.(); if (release) waiting.delete(release); });
      if (mode === "search-hold") await new Promise(resolve => { release = resolve; waiting.add(resolve); });
      if (response.destroyed) return;
      response.setHeader("content-type", "application/json");
      if (mode === "search-fail") { finished = true; response.writeHead(503).end(JSON.stringify({ error: "Synthetic search outage" })); return; }
      finished = true; response.end(JSON.stringify({ results: [{ title: "Synthetic FDA guidance", url: "https://www.fda.gov/synthetic-guidance", content: "Public synthetic FDA guidance requires traceable evidence. No internal project information is present.", published_date: "2026-01-01" }] })); return;
    }
    if (url.pathname !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    let body = ""; for await (const bytes of request) body += bytes;
    const data = JSON.parse(body); const isWbs = data.messages.some(message => message.content?.includes('"tasks"'));
    const isMeeting = data.messages.some(message => message.content?.includes("会议纪要助手"));
    const isAcceptance = data.messages.some(message => message.content?.includes("结项缺口诊断助手"));
    const isAssistant = data.messages.some(message => message.content?.includes("MedPM 医疗交付内部知识助手"));
    const isGeneral = data.messages.some(message => message.content?.includes("你是通用行业知识助手"));
    const isWeb = data.messages.some(message => message.content?.includes("你是联网研究助手"));
    const activeRules = isAcceptance ? JSON.parse(data.messages.findLast(message => message.role === "user").content).activeRules : [];
    const ruleLabels = { UNCOMPLETED_TASKS: "未完成任务", MISSING_DELIVERABLES: "缺少批准交付物", MISSING_SIGNATURES: "当前轮次缺少签名", UNLINKED_ACTION_ITEMS: "行动项未转任务", EMPTY_PROJECT: "空项目" };
    const result = isAcceptance ? { sections: activeRules.map(rule => ({ rule, advice: "请核实对应业务证据，明确整改责任与实际完成安排，补齐可追溯记录后重新体检。" })) } : isMeeting ? { summary: "会议确认了接口联调范围与验收安排，由张工整理联调计划，待项目经理人工确认后落实。", actionItems: [{ text: "完成接口联调计划", suggestedAssigneeId: null, suggestedAssigneeName: "张工", expectedDueDate: "2026-10-26" }, { text: "整理验收证据清单", suggestedAssigneeId: null, suggestedAssigneeName: null, expectedDueDate: null }] } : isWbs ? { tasks: ["确认交付范围", "编制验收用例", "复核追溯证据"].map((title, index) => ({ title, description: "合成建议：明确交付物与验收条件，待项目经理人工确认。", estimateHours: index + 2, suggestedRole: "QA", dependencies: [], sourceChunkIds: [] })) } : { overview: "合成合规检查：已核对当前任务的需求、测试与审计证据，结论待人工复核。", keyChanges: [], anomalies: [], reviewItems: [] };
    if (!data.stream) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ id: "synthetic-chat", object: "chat.completion", created: 0, model: "synthetic-stream", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(result) } }] })); return; }
    const currentMode = mode; const attempt = isWbs || isMeeting || isAcceptance ? ++attempts : 0;
    const jsonOnly = data.response_format?.type === "json_object";
    const correcting = ["dirty-retry", "retry-hold-1", "retry-hold-2", "invalid"].includes(currentMode);
    const invalid = (isWbs || isMeeting || isAcceptance) && correcting && (attempt === 1 || currentMode === "invalid" || currentMode === "retry-hold-2" && attempt === 2);
    if (isWbs && currentMode === "dirty-retry") for (const task of result.tasks) { task.title = `<PUBLIC_PREVIEW>${task.title}</PUBLIC_PREVIEW>`; task.description = `公开<internal>synthetic-private-content</internal>交付建议，待人工确认。`; }
    if (isAcceptance && currentMode === "hallucination") for (const section of result.sections) section.advice = "本项目完全合规，可以提交验收，所有问题均已自动处理。";
    started += 1; let finished = false; let closed = false; let release;
    response.on("close", () => { closed = true; if (!finished) cancelled += 1; release?.(); if (release) waiting.delete(release); });
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = content => { if (!closed) response.write(`data: ${JSON.stringify({ id: "synthetic-chat", object: "chat.completion.chunk", created: 0, model: "synthetic-stream", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`); };
    if (isGeneral || isWeb) {
      if (isGeneral) generalStarted++; else { webAnswerStarted++; lastWebInput = data.messages.findLast(message => message.role === "user")?.content ?? ""; }
      const answer = isGeneral ? "以下基于通用行业知识，未经验证项目库\n\nWBS是工作分解结构，用于把交付目标逐层拆成可管理的工作包。启动会宜明确目标、范围、职责、里程碑和沟通机制，具体安排仍需项目团队确认。" : "以下基于联网资料，非公司内部制度。公开指南强调保留可追溯证据，具体适用范围仍需人员核验 [1]。";
      for (let offset = 0; offset < answer.length && !closed; offset += 5) { send(answer.slice(offset, offset + 5)); await new Promise(resolve => setTimeout(resolve, 40)); }
      if (mode === "hold" && !closed) await new Promise(resolve => { release = resolve; waiting.add(resolve); });
      if (!closed) { finished = true; response.end("data: [DONE]\n\n"); } return;
    }
    if (isAssistant) {
      const answer = "<PUBLIC_PREVIEW><internal>synthetic-private-content</internal>内部项目资料要求记录签名意图与完成日期 [1]。相关交付证据应由人员核对，不能用模型推断替代实际记录。";
      for (let offset = 0; offset < answer.length && !closed; offset += 5) { send(answer.slice(offset, offset + 5)); await new Promise(resolve => setTimeout(resolve, 70)); }
      if (currentMode === "hold" && mode !== "release" && !closed) await new Promise(resolve => { release = resolve; waiting.add(resolve); });
      if (!closed) { finished = true; response.end("data: [DONE]\n\n"); } return;
    }
    const preview = isAcceptance ? `<PUBLIC_PREVIEW>数据库已确认存在以下结项缺口：${activeRules.map(rule => ruleLabels[rule]).join("、")}。这些问题必须逐项整改，补齐真实证据并完成责任确认，不得以风险说明替代业务记录。` : isMeeting ? "<PUBLIC_PREVIEW>会议确认了接口联调范围与验收安排。张工负责整理联调计划，截止日期需人工复核；本次还需汇总验收证据清单。以上是待确认的会议摘要，不自动创建任务。" : "<PUBLIC_PREVIEW>正在核对当前任务的交付范围与可追溯证据。将结合验收条件，整理可执行、可复核的建议。这里展示的是公开执行说明，最终结构化结果仍需人工确认。";
    const publicText = isAcceptance && currentMode === "hallucination" ? "<PUBLIC_PREVIEW>项目完全合规，可以提交验收。" : correcting ? preview.replace("正在核对", "<PUBLIC_PREVIEW><internal>synthetic-private-content</internal>正在核对") : preview;
    if (!jsonOnly) for (let offset = 0; offset < publicText.length && !closed; offset += 5) { send(publicText.slice(offset, offset + 5)); await new Promise(resolve => setTimeout(resolve, 60)); }
    response.flushHeaders();
    if (mode !== "release" && (currentMode === "hold" || jsonOnly && (currentMode === "dirty-retry" || currentMode === "retry-hold-1" && attempt === 2 || currentMode === "retry-hold-2" && attempt === 3)) && !closed) await new Promise(resolve => { release = resolve; waiting.add(resolve); });
    if (closed) return;
    await new Promise(resolve => setTimeout(resolve, 800));
    const payload = invalid ? '{"tasks":[{"estimateHours":"invalid"}]}' : JSON.stringify(result);
    send(`${jsonOnly ? "" : "<RESULT_JSON>"}${payload}`);
    if (!closed) { finished = true; response.end("data: [DONE]\n\n"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
