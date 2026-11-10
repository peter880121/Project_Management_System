/** Only a search hint; it never changes the server-resolved authorization scope. */
export function contactSearchTerm(question: string): string | null {
  const lines = question.split("\n");
  if (!/(联系|电话|手机|邮箱|邮件|contact|e-?mail|phone)/i.test(lines[0])) return null;
  if (lines.length > 1 && /他|她|这|那|该|their/i.test(lines[0])) return contactSearchTerm(lines.at(-1)!);
  question = lines[0];
  if (!/(联系|电话|手机|邮箱|邮件|contact|e-?mail|phone)/i.test(question)) return null;
  const email = question.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]; if (email) return email;
  const term = question.replace(/联系方式|联系电话|电话号码|电子邮件|公司内部|公司|内部|项目|联系人|负责人|请问|帮我|查找|查询|搜索|一下|请|找|联系|电话|手机|邮箱|邮件|是多少|是什么|多少|什么|怎么|如何|哪里|可以|的|有|吗|呢|[？?，,。.:：\s]/g, "").replace(/(?:工程师|老师|经理|同事|先生|女士|工)$/u, "").trim();
  return term.length >= 1 && term.length <= 40 ? term : null;
}
