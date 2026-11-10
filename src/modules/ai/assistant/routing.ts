export type AssistantMode = "SMART" | "INTERNAL" | "WEB";
export type AssistantIntent = "INTERNAL" | "GENERAL" | "WEB" | "REPORT_GUARD" | "NEED_WEB";
export const GENERAL_PREFIX = "以下基于通用行业知识，未经验证项目库";
export const REPORT_MESSAGE = "当前助手暂不支持直接查询实时业务报表，请前往『项目看板』或『数据决策中心』查看。";
export const WEB_WARNING = "⚠️ 联网模式会将您的提问发送至外部搜索引擎，请勿输入项目敏感代码或医疗数据。";
const concept = /是什么|什么是|什么叫|定义|概念|如何|怎么|怎样|为什么|区别|解释|介绍|建议|起草|拟一|写一|润色|翻译|模板|方法|你好|您好|你能做什么|what is|how to/i;
export function hasProjectTerms(question: string, names: string[] = []) {
  const q = question.normalize("NFKC");
  return names.some(name => name.trim().length >= 3 && q.toLocaleLowerCase().includes(name.toLocaleLowerCase())) || /[\p{L}\d]{1,24}(?:市|县|区|院|医院|公司|集团)[\p{L}\d\s-]{0,12}(?:HIS|EMR|LIS|PACS|医院|系统|项目)|\b(?:HIS|EMR|LIS|PACS)[-_][A-Z0-9_-]{3,}|[A-Z][A-Z0-9]{1,8}-\d{3,}|\b(?:10|127)\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|项目代号|内部代码|专有代码/iu.test(q);
}
export function realtimeQuestion(question: string) {
  const q = question.normalize("NFKC").replace(/\s+/g, "");
  const subject = /任务|项目|人员|成员|资源|负荷|负载|工作量|交付物|验收|工时|完成率|逾期|进度|签名|tasks?|projects?|workload|overdue|members?|deliverables?|progress/i;
  const count = /多少|几个|几项|几条|总数|数量|统计|排名|完成率|谁.{0,8}(?:最忙|最多|最重)|(?:负荷|负载|工作量).{0,6}(?:最|当前)|(?:当前|现在|目前|今天|本周|截至|截止).{0,12}(?:进度|完成|负荷|工时|项目状态)|(?:列出|查询|查看|显示|查查).{0,10}(?:未完成|已完成|逾期|进行中|任务列表)|逾期任务|howmany|taskcount|total|busiest|mostloaded|overduetasks|currentprogress/i;
  // Definition questions are educational unless they also explicitly request a count/ranking.
  if (/^(?:请问|请解释|解释一下)?(?:什么是|什么叫).{0,25}[?？。]?$|^.{1,25}(?:是什么|的定义是什么|指什么)[?？。]?$/.test(q) && !/多少|几个|几项|总数|排名|谁/.test(q)) return false;
  return subject.test(q) && (count.test(q) || /(?:本项目|该项目|我们项目|当前项目).{0,15}(?:还欠|还缺|还剩|尚缺|有哪些|哪些|是否完成|进展|进度)|(?:任务|项目).{0,10}(?:谁负责|负责人是谁)|谁.{0,8}负责.{0,8}(?:任务|项目)/.test(q));
}
export function routeQuestion(mode: AssistantMode, question: string, names: string[] = []): { intent: AssistantIntent; reason: string } {
  if (realtimeQuestion(question)) return { intent: "REPORT_GUARD", reason: "REALTIME_BUSINESS_DATA_UNSUPPORTED" };
  if (/联系|电话|手机|邮箱|邮件|contact|e-?mail|phone/i.test(question)) return { intent: "INTERNAL", reason: "INTERNAL_CONTACTS_FIRST" };
  if (mode === "INTERNAL") return { intent: "INTERNAL", reason: "STRICT_INTERNAL_MODE" };
  if (/内部|我司|本公司|本项目|这个项目|该项目|我们.{0,8}项目/.test(question)) return { intent: "INTERNAL", reason: "INTERNAL_FACTS_ONLY" };
  if (mode === "WEB") return { intent: "WEB", reason: "USER_SELECTED_WEB_RESEARCH" };
  if (hasProjectTerms(question, names) || /前面|上面|这个|这些|该文档|该任务|他的|她的/.test(question)) return { intent: "INTERNAL", reason: "PROJECT_SPECIFIC_OR_CONTEXTUAL" };
  if (/最新|现行|最近发布|当前版本|今年.{0,8}(?:法规|标准|政策)|发布日期/.test(question)) return { intent: "NEED_WEB", reason: "FRESHNESS_REQUIRES_EXPLICIT_WEB_MODE" };
  if (concept.test(question)) return { intent: "GENERAL", reason: "GENERAL_EDUCATION_OR_DRAFT" };
  return { intent: "INTERNAL", reason: "CONSERVATIVE_INTERNAL_FALLBACK" };
}
