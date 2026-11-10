import { z } from "zod";
import { countsSchema, RULES, ruleLabels, ruleSchema, type CheckCounts } from "@/modules/projects/acceptance-check/types";
import { cleanGeneratedValue, assertCleanGeneratedValue } from "../streaming/clean-text";
const forbidden = /完全合规|全部通过|零风险|无任何风险|可以提交验收|可提交验收|合规检查通过/;
const responseSchema = z.object({ sections: z.array(z.object({ rule: ruleSchema, advice: z.string().trim().min(10).max(600).refine(text => !forbidden.test(text) && !/[0-9０-９]/.test(text), "禁止正向结论或自行陈述数字") }).strict()).min(1).max(6) }).strict();
export function parseDiagnosis(raw: string, input: CheckCounts) {
  const value = cleanGeneratedValue(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); assertCleanGeneratedValue(value);
  const result = responseSchema.parse(value); const active = RULES.filter(rule => (input[rule] ?? 0) > 0);
  if (result.sections.length !== active.length || new Set(result.sections.map(s => s.rule)).size !== active.length || result.sections.some(s => !active.includes(s.rule))) throw new SyntaxError("Report introduced or omitted a rule");
  return result;
}
export function reportText(counts: CheckCounts, sections?: z.infer<typeof responseSchema>["sections"]) {
  countsSchema.parse(counts);
  return `结项缺口诊断报告\n\n数据库核验发现以下缺口。当前不能正常提交验收；本报告建议需要人工复核。\n\n${RULES.filter(rule => (counts[rule] ?? 0) > 0).map(rule => `${ruleLabels[rule]}：${counts[rule]} 项\n整改建议：${sections?.find(s => s.rule === rule)?.advice ?? "请前往对应业务页面逐项核实并整改，补齐真实证据后重新执行体检。"}`).join("\n\n")}`;
}
/** Hold phrase tails across chunks so a forbidden affirmative verdict never reaches delta. */
export class DiagnosisPreviewGuard {
  private buffer = "";
  push(text: string) { this.buffer += text; if (forbidden.test(this.buffer) || /[0-9０-９]/.test(this.buffer)) throw new SyntaxError("Untrusted diagnostic claim"); const ready = this.buffer.slice(0, -32); this.buffer = this.buffer.slice(-32); return ready; }
  finish() { const rest = this.buffer; this.buffer = ""; return rest; }
}
