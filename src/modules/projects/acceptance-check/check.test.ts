import { describe, expect, it } from "vitest";
import { gapCount, type CheckCounts } from "./types";
import { DiagnosisPreviewGuard, parseDiagnosis, reportText } from "@/modules/ai/acceptance-check/validation";
import { ACCEPTANCE_DIAGNOSIS_PROMPT } from "@/modules/ai/acceptance-check/prompt";
import { CheckExpiredError } from "./service";
import { projectErrorResponse } from "../http";
import { projectCapabilities } from "../capabilities";
const counts: CheckCounts = { UNCOMPLETED_TASKS: 0, MISSING_DELIVERABLES: 0, MISSING_SIGNATURES: 2, UNLINKED_ACTION_ITEMS: 0, EMPTY_PROJECT: 0 };
const advice = "请核实当前完成轮次的签名记录，按真实业务进展重新签署，禁止补造历史证据。";
describe("deterministic compliance and AI factual boundaries", () => {
  it("makes the anti-hallucination restriction explicit in the prompt", () => {
    expect(ACCEPTANCE_DIAGNOSIS_PROMPT).toContain("你只能根据传入的 JSON 缺口数据生成报告"); expect(ACCEPTANCE_DIAGNOSIS_PROMPT).toContain("严禁编造未列出的缺口"); expect(ACCEPTANCE_DIAGNOSIS_PROMPT).toContain("严禁使用“完全合规”等正向结论");
  });
  it("takes exact totals from server counts and only accepts the actual rules", () => {
    const value = parseDiagnosis(JSON.stringify({ sections: [{ rule: "MISSING_SIGNATURES", advice }] }), counts);
    expect(reportText(counts, value.sections)).toContain("当前完成轮次缺少电子签名：2 项"); expect(reportText(counts)).not.toContain("未完成任务："); expect(gapCount(counts)).toBe(2);
    for (const sections of [[], [{ rule: "UNCOMPLETED_TASKS", advice }], [{ rule: "MISSING_SIGNATURES", advice }, { rule: "MISSING_SIGNATURES", advice }]]) expect(() => parseDiagnosis(JSON.stringify({ sections }), counts)).toThrow();
  });
  it("rejects positive verdicts, invented numbers, unknown fields and model-supplied passed", () => {
    for (const text of ["项目完全合规，可以直接提交验收，无需进一步处理。", "请补齐另外 99 份文件并重新审查当前证据。", "本项目零风险，所有缺口均已经自动处理完成。"] ) expect(() => parseDiagnosis(JSON.stringify({ sections: [{ rule: "MISSING_SIGNATURES", advice: text }] }), counts)).toThrow();
    expect(() => parseDiagnosis(JSON.stringify({ passed: true, sections: [{ rule: "MISSING_SIGNATURES", advice }] }), counts)).toThrow();
  });
  it("blocks split affirmative phrases before any of them reach preview", () => {
    const guard = new DiagnosisPreviewGuard(); let preview = guard.push("数据库确认了签名缺口。"); preview += guard.push("完全"); expect(() => guard.push("合规")).toThrow(); expect(preview).not.toContain("完全");
    const safe = new DiagnosisPreviewGuard(); const input = "需要人工核查真实签名记录，并完成缺口整改。"; expect(safe.push(input) + safe.finish()).toBe(input);
  });
  it("returns a stable expiry code for the frontend modal", async () => {
    const response = projectErrorResponse(new CheckExpiredError()); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CHECK_STALE", error: "体检结果已失效（因为数据被修改），请重新体检。" });
  });
  it("requires an explicit project grant for PM overrides and disables every action after archive", () => {
    const project = { status: "ACTIVE", ownerId: "pm", rowVersion: 1, archivedAt: null };
    expect(projectCapabilities(project, { id: "pm", role: "PM" }).canOverrideAcceptance).toBe(false);
    expect(projectCapabilities(project, { id: "pm", role: "PM" }, true).canOverrideAcceptance).toBe(true);
    expect(projectCapabilities(project, { id: "admin", role: "ADMIN" }).canOverrideAcceptance).toBe(true);
    expect(projectCapabilities({ ...project, status: "ARCHIVED" }, { id: "admin", role: "ADMIN" }).canOverrideAcceptance).toBe(false);
  });
});
