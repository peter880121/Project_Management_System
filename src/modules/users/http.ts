import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { UserManagementError } from "./services";

export function userManagementResponse(error: unknown) {
  if (error instanceof UserManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "无法创建用户，请检查输入" }, { status: 409 });
    if (error.code === "P2034") return NextResponse.json({ error: "账号状态已变化，请刷新" }, { status: 409 });
  }
  // Never log Prisma arguments: a failed create can carry a password hash.
  console.error("User management operation failed");
  return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}
