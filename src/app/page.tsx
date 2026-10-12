import Link from "next/link";

const agents = [
  { title: "智能 WBS 与工期预估", detail: "把需求拆解为可审阅的任务与工期建议。", state: "待接入" },
  { title: "合规审计追踪", detail: "发现需求、任务与测试链路中的断点。", state: "待接入" },
  { title: "资源冲突与风险预警", detail: "识别交付风险，建议由团队人工确认。", state: "待接入" },
];

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">MedPM-AI · 合规交付工作台</p>
      <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">让医疗软件交付更可追溯，也更可控。</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">AI 提供建议，团队负责确认。每项关键决策都为审计与追溯留出位置。</p>
      <Link href="/audit" className="mt-6 inline-flex rounded-md border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">查看审计日志</Link>
      <section aria-label="AI agents" className="mt-12 grid gap-5 md:grid-cols-3">
        {agents.map((agent) => (
          <article key={agent.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{agent.state}</span>
            <h2 className="mt-5 text-xl font-semibold">{agent.title}</h2>
            <p className="mt-3 leading-6 text-slate-600">{agent.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
