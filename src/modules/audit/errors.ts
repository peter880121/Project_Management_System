import { Prisma } from "@prisma/client";
import { freezeErrorResponse } from "@/modules/projects/freeze";
import { ProjectAccessError } from "@/modules/auth/project-access";

/** Only explicitly constructed business errors may expose their message over HTTP. */
export class BusinessError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export function businessErrorResponse(error: unknown) {
  const frozen = freezeErrorResponse(error); if (frozen) return frozen;
  if (error instanceof BusinessError || error instanceof ProjectAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
    return Response.json({ error: "系统繁忙，请重试" }, { status: 503 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) {
    return Response.json({ error: "数据存在并发冲突，请刷新后重试" }, { status: 409 });
  }
  console.error("Audited business operation failed");
  return Response.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}
