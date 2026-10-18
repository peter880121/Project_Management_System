import { afterEach, expect, it, vi } from "vitest";
import { ControlTextCleaner, cleanGeneratedValue, assertCleanGeneratedValue, assertNoControlMarkers } from "./clean-text";
import { ModelOutputDecoder } from "./model";

afterEach(() => vi.restoreAllMocks());
it("recognizes <PUB + LIC_PREVIEW>, masks split internal contents and logs no content", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const pieces: string[] = []; const decoder = new ModelOutputDecoder(value => pieces.push(value));
  for (const chunk of ["<PUB", "LIC_PREVIEW>", "公开<PUB", "LIC_PREVIEW>", "说明<inter", "nal>private-secret", "<internal>nested-secret</internal>", "</internal>完成", "<RESULT_JSON>{\"tasks\":[]}"]) decoder.push(chunk);
  expect(pieces.join("")).toBe("公开说明完成");
  expect(decoder.finish()).toBe('{"tasks":[]}');
  expect(warn.mock.calls).toEqual([["AI_CONTROL_TAGS_CLEANED"]]);
});
it("never leaks tags, private blocks or JSON across every possible split", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const raw = '<PUBLIC_PREVIEW>公开<internal>secret<RESULT_JSON>hidden-json</internal><PUBLIC_PREVIEW>完成</PUBLIC_PREVIEW><RESULT_JSON>{"tasks":[]}';
  for (let split = 0; split <= raw.length; split++) {
    const preview: string[] = []; const decoder = new ModelOutputDecoder(value => preview.push(value));
    decoder.push(raw.slice(0, split)); decoder.push(raw.slice(split));
    expect(preview.join("")).toBe("公开完成"); expect(decoder.finish()).toBe('{"tasks":[]}');
  }
});
it("preserves business comparisons and ordinary Markdown while rejecting incomplete hidden blocks", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const cleaner = new ControlTextCleaner();
  expect(cleaner.push("**预计** < 5 小时").text).toBe("**预计** < 5 小时"); cleaner.finish();
  const incomplete = new ControlTextCleaner(); expect(incomplete.push("公开<internal>secret").text).toBe("公开");
  expect(() => incomplete.finish()).toThrow(SyntaxError);
  const partial = new ControlTextCleaner(); expect(partial.push("<PUB").text).toBe(""); expect(() => partial.finish()).toThrow();
});
it("cleans generated structured strings recursively and rejects dirty keys/encoded control tags", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = cleanGeneratedValue({ tasks: [{ title: "<PUBLIC_PREVIEW>任务</PUBLIC_PREVIEW>", description: "公开<internal>private</internal>交付", estimateHours: 2 }] });
  expect(result).toEqual({ tasks: [{ title: "任务", description: "公开交付", estimateHours: 2 }] });
  expect(() => assertCleanGeneratedValue(result)).not.toThrow();
  expect(() => assertCleanGeneratedValue({ "<internal>": "value" })).toThrow();
  expect(() => assertCleanGeneratedValue("&lt;PUBLIC_PREVIEW&gt;")).toThrow();
  expect(() => assertNoControlMarkers({ snapshot: "<internal>poisoned evidence</internal>" })).toThrow();
  expect(() => assertNoControlMarkers({ snapshot: "&lt;PUBLIC_PREVIEW&gt;" })).toThrow();
  expect(() => assertNoControlMarkers({ snapshot: "真实业务比较 < 5" })).not.toThrow();
});
