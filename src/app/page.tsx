import Link from "next/link";

export const dynamic = "force-dynamic";

const agents = [
  { title: "智能 WBS 与工期预估", detail: "入口：项目 → 选择项目 →「智能 WBS 分解」。在独立页面输入合成需求，生成任务与工期建议，再按前置依赖顺序逐条采纳。", state: "已接入 · PM", href: "/projects", label: "选择项目，使用 WBS" },
  { title: "合规审计追踪", detail: "入口：主导航「审计」→ 选择项目 →「生成合规摘要」。ADMIN / QA 可检查需求、任务与测试链路；QA 可确认发现项。", state: "已接入 · ADMIN / QA", href: "/audit", label: "打开审计与合规审查" },
  { title: "资源冲突与风险预警", detail: "入口：项目 → 选择项目 →「风险预警」→「扫描项目风险」。PM 查看风险依据并人工处置；自动扫描需启用计划且后台扫描服务运行。", state: "已接入 · PM", href: "/projects", label: "选择项目，扫描风险" },
];

export default async function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-16">

      <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">MedPM-AI · 合规交付工作台</p>
      <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">让医疗软件交付更可追溯，也更可控。</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">AI 提供建议，团队负责确认。每项关键决策都为审计与追溯留出位置。</p>
      <Link href="/projects" className="ml-3 mt-6 inline-flex rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900">打开任务看板</Link>
      <section aria-label="AI agents" className="mt-12 grid gap-5 md:grid-cols-3">
        {agents.map((agent) => (
          <article key={agent.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{agent.state}</span>
            <h2 className="mt-5 text-xl font-semibold">{agent.title}</h2>
            <p className="mt-3 leading-6 text-slate-600">{agent.detail}</p>
            <Link href={agent.href} className="mt-4 inline-flex text-sm font-semibold text-teal-800">{agent.label}</Link>
          </article>
        ))}
      </section>
    </main>
  );
}
