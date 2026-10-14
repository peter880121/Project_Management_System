import type { ReactNode } from "react";
import Link from "next/link";

export function AuthCard({ title, description, children, footer }: {
  title: string; description: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 text-sm font-semibold text-teal-800">MedPM-AI · 返回首页</Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-slate-600">{description}</p>
        {children}
        {footer && <div className="mt-6 border-t border-slate-100 pt-5 text-sm">{footer}</div>}
      </section>
    </main>
  );
}
