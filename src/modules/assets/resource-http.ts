import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "./http";
import type { Role } from "@prisma/client";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { getCurrentUser } from "@/modules/auth/session";
export async function assetResourceHttp(kind: "deliverable" | "meeting", id: string, roles: Role[], action: (actor: AuthenticatedUser, projectId: string) => Promise<Response>, request?: Request) {
  if (!await getCurrentUser()) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "资产 ID 无效" }, { status: 400 });
  const row = kind === "deliverable" ? await prisma.deliverable.findUnique({ where: { id }, select: { projectId: true } }) : await prisma.meetingRecord.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) return Response.json({ error: "资产不存在或不可访问" }, { status: 403 });
  return assetHttp(row.projectId, roles, actor => action(actor, row.projectId), request);
}
