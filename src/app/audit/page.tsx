import AuditLogViewer from "./viewer";
import Link from "next/link";

export const metadata = { title: "审计日志 · MedPM-AI" };

export default function AuditPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-teal-700 hover:underline" href="/">返回工作台</Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">审计日志</h1>
      <p className="mt-2 max-w-3xl text-slate-600">
        仅 ADMIN 和 QA 可以查询。日志采用追加写入；按项目、操作人、操作类型和时间范围筛选。
      </p>
      <AuditLogViewer />
    </main>
  );
}
