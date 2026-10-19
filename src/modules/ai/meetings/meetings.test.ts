import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { generateMeetingOutput, parseMeetingOutput } from "./service";
import { matchingMembers, memberSearchSeed } from "./member-match";
import { storedItemsSchema, summarizeSchema, transcriptFits } from "./types";
import type { GenerationStream } from "../streaming/protocol";
import { ModelOutputDecoder } from "../streaming/model";
import { containsSensitiveMeetingInput } from "./privacy";
const valid = { summary: "合成会议已确认联调范围。", actionItems: [{ text: "整理联调方案", suggestedAssigneeId: null, suggestedAssigneeName: "张工", expectedDueDate: "2026-10-26" }] };
const stream = (signal = new AbortController().signal): GenerationStream => ({ signal, generationId: randomUUID(), emit: vi.fn() });
describe("meeting AI boundaries", () => {
  it("accepts calendar deadlines while still blocking contact and patient identifiers", () => {
    expect(containsSensitiveMeetingInput("张工在 2026-10-26 提交合成联调计划。")).toBe(false);
    expect(containsSensitiveMeetingInput("联系电话：13812345678")).toBe(true);
    expect(containsSensitiveMeetingInput("患者姓名：某某")).toBe(true);
    expect(containsSensitiveMeetingInput("联系 fake@example.com")).toBe(true);
  });
  it("cleans fragmented transport/private tags from previews and final JSON", () => {
    const chunks: string[] = []; const decoder = new ModelOutputDecoder(text => chunks.push(text));
    for (const chunk of ["<PUB", "LIC_PREVIEW>", "合成摘要", "<inter", "nal>秘密", "</internal>", "<RESULT_", "JSON>", JSON.stringify({ ...valid, summary: "<PUBLIC_PREVIEW>合成摘要<internal>秘密</internal>" })]) decoder.push(chunk);
    const result = parseMeetingOutput(decoder.finish(), new Set());
    expect(chunks.join("")).toBe("合成摘要"); expect(result.summary).toBe("合成摘要"); expect(JSON.stringify(result)).not.toMatch(/PUBLIC_PREVIEW|internal|秘密/);
  });
  it("rejects extra fields, forged owners and impossible calendar dates", () => {
    expect(() => parseMeetingOutput(JSON.stringify({ ...valid, taskId: randomUUID() }), new Set())).toThrow();
    expect(() => parseMeetingOutput(JSON.stringify({ ...valid, actionItems: [{ ...valid.actionItems[0], suggestedAssigneeId: randomUUID() }] }), new Set())).toThrow();
    expect(() => parseMeetingOutput(JSON.stringify({ ...valid, actionItems: [{ ...valid.actionItems[0], expectedDueDate: "2026-02-30" }] }), new Set())).toThrow();
    expect(parseMeetingOutput(JSON.stringify({ ...valid, actionItems: [{ ...valid.actionItems[0], expectedDueDate: null }] }), new Set()).actionItems[0].expectedDueDate).toBeNull();
  });
  it("retries malformed structure exactly twice and emits visible progress", async () => {
    const invoke = vi.fn(async () => "{}"); const channel = stream();
    await expect(generateMeetingOutput(invoke, channel, new Set())).rejects.toMatchObject({ status: 422, message: expect.stringContaining("手动整理") });
    expect(invoke).toHaveBeenCalledTimes(3); expect(channel.emit).toHaveBeenCalledTimes(2); expect(channel.emit).toHaveBeenCalledWith({ event: "progress", data: { stage: "retrying", message: "输出格式校验未通过，正在自动修正..." } });
  });
  it("can recover on the second correction and does not retry a provider failure", async () => {
    const invoke = vi.fn().mockResolvedValueOnce("{}").mockResolvedValueOnce("{}").mockResolvedValueOnce(JSON.stringify(valid));
    expect(await generateMeetingOutput(invoke, stream(), new Set())).toEqual(valid);
    const unavailable = vi.fn().mockRejectedValue(new Error("network unavailable"));
    await expect(generateMeetingOutput(unavailable, stream(), new Set())).rejects.toThrow("network unavailable"); expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it("immediately propagates cancellation in either correction without a further attempt", async () => {
    for (const cancelAttempt of [1, 2]) {
      const ac = new AbortController(); const invoke = vi.fn(async (attempt: number) => { if (attempt === cancelAttempt) { ac.abort(new DOMException("Cancelled", "AbortError")); ac.signal.throwIfAborted(); } return "{}"; });
      await expect(generateMeetingOutput(invoke, stream(ac.signal), new Set())).rejects.toMatchObject({ name: "AbortError" }); expect(invoke).toHaveBeenCalledTimes(cancelAttempt + 1);
    }
  });
  it("rejects overlong transcripts and reserves 30 percent of the context", () => {
    expect(transcriptFits("会".repeat(8000), 100000)).toBe(true); expect(transcriptFits("会".repeat(8001), 100000)).toBe(false);
    expect(transcriptFits("会".repeat(700), 3000)).toBe(true); expect(transcriptFits("会".repeat(701), 3000)).toBe(false);
    expect(transcriptFits("会".repeat(600), 3000, 101)).toBe(false);
    expect(summarizeSchema.safeParse({ text: "会".repeat(8001), expectedVersion: 1, syntheticDataConfirmed: true }).success).toBe(false);
  });
  it("seeds Zhang-gong search locally and offers full-list fallback", () => {
    const members = [{ id: "1", name: "张明" }, { id: "2", name: "张晓 QA" }, { id: "3", name: "李华" }];
    expect(memberSearchSeed("张工")).toBe("张"); expect(matchingMembers(members, memberSearchSeed("张工"))).toEqual(members.slice(0, 2)); expect(matchingMembers(members, "")).toEqual(members); expect(matchingMembers(members, "无人匹配")).toEqual([]);
  });
  it("keeps legacy checklist JSON compatible after conversion and rejects duplicate IDs", () => {
    const id = randomUUID(); expect(storedItemsSchema.parse([{ id, text: "旧行动项", checked: false, taskId: randomUUID(), convertedAt: new Date().toISOString(), convertedById: randomUUID() }])).toHaveLength(1);
    expect(storedItemsSchema.safeParse([{ id, text: "A", checked: false }, { id, text: "B", checked: false }]).success).toBe(false);
  });
});
