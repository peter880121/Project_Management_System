import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { ProjectAccessError } from "@/modules/auth/project-access";
import { ProjectError } from "@/modules/projects/services";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const privateJson = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: { ...privateHeaders, ...init.headers },
  });

export async function actorHttp(
  request: Request,
  action: (actor: {
    actorId: string;
    ip: string;
    userAgent: string;
  }) => Promise<Response>,
  context = "数据",
) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return privateJson(
        { error: "请先登录", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    const response = await action({
      actorId: user.id,
      ip:
        request.headers
          .get("x-forwarded-for")
          ?.split(",")[0]
          ?.trim()
          .slice(0, 45) ?? "unknown",
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? "unknown",
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  } catch (error) {
    if (error instanceof ProjectError || error instanceof ProjectAccessError)
      return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return privateJson(
        { error: "输入无效，请检查查询条件或表单内容" },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P2002", "P2034"].includes(error.code))
        return privateJson(
          { error: "数据已变化，请刷新后重试" },
          { status: 409 },
        );
      if (error.code === "P2028")
        return privateJson({ error: "系统繁忙，请重试" }, { status: 503 });
    }
    console.error("AUTHENTICATED_OPERATION_FAILED");
    return privateJson(
      { error: `${context}操作失败，请稍后重试` },
      { status: 500 },
    );
  }
}
