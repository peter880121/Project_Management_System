export function canRefineTask(title: string): boolean {
  return ["蓝图", "调研"].some(keyword => title.includes(keyword));
}
export function canCheckTaskEvidence(title: string): boolean {
  return ["测试", "UAT", "CSV"].some(keyword => title.toUpperCase().includes(keyword));
}
