import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const actor = await getCurrentUser(); if (!actor) return Response.json({ error: "请先登录" }, { status: 401 });
  const page = z.coerce.number().int().min(1).max(10000).safeParse(new URL(request.url).searchParams.get("page") ?? 1); if (!page.success) return Response.json({ error: "分页无效" }, { status: 400 });
  const [rows, unreadCount] = await Promise.all([prisma.projectNotification.findMany({ where: { recipientId: actor.id }, select: { id: true, projectId: true, acceptanceId: true, readAt: true, createdAt: true, project: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page.data - 1) * 20, take: 21 }), prisma.projectNotification.count({ where: { recipientId: actor.id, readAt: null } })]);
  return Response.json({ data: rows.slice(0, 20), hasMore: rows.length > 20, unreadCount }, { headers: { "Cache-Control": "no-store" } });
}
