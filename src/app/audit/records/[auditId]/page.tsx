import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { hasProjectAccess } from "@/modules/auth/project-access";
export const dynamic = "force-dynamic";
export default async function AuditRecordPage({ params }: { params: Promise<{ auditId: string }> }) {
  const actor = await getCurrentUser(); if (requireRole(actor, ["ADMIN", "QA"])) return <main className="p-8">仅 ADMIN 和 QA 可查看审计证据。</main>;
  const { auditId } = await params;
  if (!z.uuid().safeParse(auditId).success) notFound();
  const row = await prisma.auditLog.findUnique({ where: { id: auditId }, include: { actor: { select: { id: true, name: true, role: true } } } });
  if (!row) notFound();
  if (actor!.role !== "ADMIN" && (!row.projectId || !await hasProjectAccess(actor!, row.projectId))) notFound();
  return <main className="mx-auto max-w-4xl space-y-4 p-8"><Link href="/audit">返回审计页</Link><h1 className="text-2xl font-semibold">原始审计记录</h1><pre className="overflow-auto whitespace-pre-wrap break-all rounded border p-4">{JSON.stringify(row, null, 2)}</pre></main>;
}
