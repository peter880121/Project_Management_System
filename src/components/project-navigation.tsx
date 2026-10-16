import Link from "next/link";

export function ProjectNavigation({ projectId, role }: { projectId: string; role: string }) {
  const base = `/projects/${projectId}`;
  const links = [
    { href: `${base}/planning`, label: "排期与人员容量 →" },
    { href: `${base}/traceability`, label: "维护需求与测试追溯 →" },
    { href: `${base}/documents`, label: "项目文档 →" },
    { href: `${base}/members`, label: "项目成员 →" },
    ...(role === "PM" ? [{ href: `${base}/wbs`, label: "智能 WBS 分解 →" }, { href: `${base}/risks`, label: "风险预警 →" }] : []),
    ...(["ADMIN", "QA"].includes(role) ? [{ href: `${base}/exports`, label: "合规导出 →" }] : []),
  ];
  return <nav aria-label="项目功能" className="mt-6 flex flex-wrap gap-3">{links.map(link => <Link key={link.href} href={link.href} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50">{link.label}</Link>)}</nav>;
}
