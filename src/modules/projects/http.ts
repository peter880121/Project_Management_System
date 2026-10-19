import { Prisma } from "@prisma/client";
import { freezeErrorResponse } from "./freeze";
import { ProjectError } from "./services";
import { ProjectAccessError } from "@/modules/auth/project-access";

export function projectErrorResponse(error: unknown) {
  const frozen = freezeErrorResponse(error); if (frozen) return frozen;
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ProjectError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") return Response.json({ error: "系统繁忙，请重试" }, { status: 503 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return Response.json({ error: "数据重复或已被更新，请刷新后重试" }, { status: 409 });
  console.error("Project operation failed");
  return Response.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}
