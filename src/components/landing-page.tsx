import Link from "next/link";
import { Activity, ArrowRight, Check, GitBranch, ShieldCheck, Radar, LockKeyhole, Database } from "lucide-react";

const capabilities = [
  { icon: GitBranch, title: "智能 WBS 与工期预估", description: "把复杂需求转化为清晰的交付路径。结合历史项目经验，辅助拆解任务与预估工期，让每一步计划都有依据。", detail: "从需求出发 · 由团队确认" },
  { icon: ShieldCheck, title: "合规审计追踪", description: "连接需求、任务与测试证据，主动发现追溯链路中的缺口。让关键决策留下记录，让审查有迹可循。", detail: "串联交付证据 · 保留决策来源" },
  { icon: Radar, title: "资源冲突与风险预警", description: "识别跨项目资源冲突与延期信号，呈现风险依据与处置建议。帮助团队提前决策，始终保留人工控制。", detail: "提前发现风险 · 不自动修改状态" },
];
const safeguards = [
  { icon: LockKeyhole, title: "RBAC 权限控制", detail: "按角色授权，让职责与操作边界清晰。" },
  { icon: ShieldCheck, title: "不可篡改审计", detail: "审计日志禁止更新与删除，保留关键操作。" },
  { icon: Database, title: "医疗合规合成数据", detail: "仅使用合成数据，不使用真实患者信息。" },
];

export function LandingPage() {
  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_0%,rgba(45,212,191,0.16),transparent_60%)]" />
      <header className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <nav aria-label="产品导航" className="flex min-h-24 items-center justify-between gap-3 border-b border-white/10">
          <Link href="/" aria-label="MedPM-AI 首页" className="flex items-center gap-2 rounded-none border-0 p-0 text-lg font-semibold tracking-tight hover:shadow-none focus-visible:outline-teal-300 sm:text-xl"><span className="flex size-9 items-center justify-center rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-300"><Activity aria-hidden="true" className="size-5" /></span><span>MedPM<span className="text-teal-300">-AI</span></span></Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="border-transparent px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white hover:shadow-none focus-visible:outline-teal-300">登录</Link>
            <Link href="/register" className="rounded-lg border-teal-400/30 bg-teal-400/10 px-3 py-2 text-sm font-medium text-teal-200 hover:bg-teal-400/20 hover:shadow-none focus-visible:outline-teal-300 sm:px-4">注册体验</Link>
          </div>
        </nav>
      </header>
      <main className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <section aria-labelledby="landing-title" className="pb-16 pt-16 sm:pb-20 sm:pt-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-teal-400/5 px-3 py-1.5 text-xs font-medium tracking-wide text-teal-200"><span aria-hidden="true" className="size-1.5 rounded-full bg-teal-300 shadow-[0_0_10px_rgba(45,212,191,0.6)]" />面向医疗软件交付的 AI 协作平台</p>
          <h1 id="landing-title" className="mt-7 max-w-4xl text-4xl font-semibold leading-[1.2] tracking-tight sm:text-6xl lg:text-7xl">让医疗软件交付<span className="mt-2 block bg-gradient-to-r from-teal-200 via-teal-300 to-emerald-400 bg-clip-text text-transparent">更智能，更可追溯。</span></h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">从需求拆解到合规审查，让 AI 融入真实交付流程。<br className="hidden sm:block" />AI 提供有依据的建议，团队掌握每一次关键决定。</p>
          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <Link href="/login" className="inline-flex items-center gap-3 rounded-xl border-teal-300 bg-teal-300 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(45,212,191,0.15)] transition-colors hover:bg-teal-200 hover:shadow-[0_0_36px_rgba(45,212,191,0.25)] focus-visible:outline-teal-300">登录，开启智能交付<ArrowRight aria-hidden="true" className="size-4" /></Link>
            <p className="flex items-center gap-2 text-xs text-slate-400"><Check aria-hidden="true" className="size-4 text-teal-400" />人工确认 · 来源可追溯 · 决策有记录</p>
          </div>
        </section>
        <section aria-labelledby="capabilities-title" className="pb-16 sm:pb-20">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[0.2em] text-teal-300">Purpose-built intelligence</p><h2 id="capabilities-title" className="mt-3 text-2xl font-semibold tracking-tight">三个 Agent，贯穿交付关键环节</h2></div><p className="text-sm text-slate-400">有依据的建议，有边界的自动化。</p></div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, description, detail }, index) => (
              <article key={title} className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md transition-[transform,border-color,box-shadow] duration-300 hover:border-teal-400/50 hover:shadow-[0_0_32px_rgba(45,212,191,0.12)] motion-safe:hover:-translate-y-1 motion-reduce:transition-none">
                <div className="mb-7 flex items-center justify-between"><span className="inline-flex rounded-xl border border-teal-400/20 bg-teal-400/10 p-3"><Icon aria-hidden="true" className="size-6 text-teal-300" /></span><span aria-hidden="true" className="font-mono text-xs text-slate-500">/ 0{index + 1}</span></div>
                <h3 className="text-xl font-semibold text-white">{title}</h3><p className="mt-4 flex-1 text-sm leading-7 text-slate-300">{description}</p><p className="mt-7 border-t border-white/10 pt-4 text-xs text-teal-200/80">{detail}</p>
              </article>
            ))}
          </div>
        </section>
        <section aria-label="信任与数据边界" className="border-t border-white/10 py-9"><div className="grid gap-6 sm:grid-cols-3">{safeguards.map(({ icon: Icon, title, detail }) => <div key={title}><p className="flex items-center gap-2 text-sm font-medium text-slate-200"><Icon aria-hidden="true" className="size-4 text-teal-400" />{title}</p><p className="mt-2 text-xs leading-6 text-slate-400">{detail}</p></div>)}</div></section>
      </main>
      <footer className="relative mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 pb-7 pt-3 text-xs leading-6 text-slate-500 sm:px-8"><span>MedPM-AI · 为可信交付而构建</span><span>合成数据演示平台 · 不代表医疗合规认证</span></footer>
    </div>
  );
}
