import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { AppNavigation } from "@/components/app-navigation";
import { ReloadButton } from "@/components/reload-button";
import { listManagedUsers } from "@/modules/users/repositories";
import { listUsersSchema } from "@/modules/users/schemas";
import { UsersManager } from "./users-manager";

export const dynamic = "force-dynamic";
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let actor;
  try { actor = await getCurrentUser(); }
  catch { return <Unavailable />; }
  if (!actor) redirect("/login?next=/users");
  if (actor.role !== "ADMIN") return <main className="mx-auto max-w-4xl px-6 py-10">
    <AppNavigation user={actor} /><h1 className="mt-8 text-2xl font-semibold">无权访问用户管理</h1>
    <p className="mt-3">此页面仅对管理员开放。</p>
  </main>;
  const parsed = listUsersSchema.safeParse(await searchParams);
  if (!parsed.success) return <main className="mx-auto max-w-4xl px-6 py-10">
    <AppNavigation user={actor} /><h1 className="mt-8 text-2xl font-semibold">筛选或分页参数无效</h1>
    <Link href="/users" className="mt-4 inline-block text-teal-800 underline">重置筛选</Link>
  </main>;
  let result;
  try { result = await listManagedUsers(parsed.data); }
  catch { return <Unavailable />; }
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (result.page > lastPage) {
    const params = new URLSearchParams({ page: String(lastPage), pageSize: String(result.pageSize) });
    for (const key of ["role", "status", "keyword"] as const) if (parsed.data[key]) params.set(key, parsed.data[key]);
    redirect(`/users?${params}`);
  }
  return <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
    <AppNavigation user={actor} />
    <h1 className="mb-2 mt-8 text-3xl font-semibold">用户管理</h1>
    <p className="mb-6 text-sm text-slate-600">管理账号准入与角色。账号保留历史记录，所有变更均记录审计。</p>
    <UsersManager key={JSON.stringify(parsed.data)} actorId={actor.id} initial={result} query={parsed.data} />
  </main>;
}
function Unavailable() {
  return <main className="mx-auto max-w-4xl space-y-4 px-6 py-10"><h1 className="text-2xl font-semibold">暂时无法加载，请重试</h1><ReloadButton /></main>;
}
