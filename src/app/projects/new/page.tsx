import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { PageBackLink } from "@/components/page-back-link";
import { CreateProjectForm } from "../create-project-form";

export const dynamic = "force-dynamic";
export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/projects/new");
  if (user.role !== "PM") return <main className="mx-auto max-w-3xl p-8"><PageBackLink href="/projects">← 返回项目</PageBackLink><h1 className="text-2xl font-semibold">仅 PM 可创建项目</h1></main>;
  return <main className="mx-auto max-w-3xl px-6 py-8"><PageBackLink href="/projects">← 返回项目</PageBackLink><h1 className="text-3xl font-semibold">创建项目</h1><p className="mt-3 text-slate-600">建立项目后，可授权协作者并开始组织交付任务。</p><CreateProjectForm /></main>;
}
