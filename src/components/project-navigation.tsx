import Link from "next/link";
import { projectNavigationLinks } from "@/modules/projects/navigation";

export function ProjectNavigation({ projectId, role }: { projectId: string; role: string }) {
  const links = projectNavigationLinks(projectId, role).filter(link => link.key !== "board");
  return <nav aria-label="项目功能" className="mt-6 flex flex-wrap gap-3">{links.map(link => <Link key={link.href} href={link.href} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50">{link.label} →</Link>)}</nav>;
}
