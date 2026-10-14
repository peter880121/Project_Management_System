import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { hashPassword } from "@/modules/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().email().max(191).transform((email) => email.toLowerCase()),
  password: z.string()
    .min(8)
    .regex(/\p{L}/u, "密码至少 8 位，且必须包含字母和数字")
    .regex(/[0-9]/, "密码至少 8 位，且必须包含字母和数字"),
  inviteCode: z.string().max(256).optional(),
}).strict();

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function requestMetadata(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return {
    ip: (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 45) || null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
  };
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "请求格式无效");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.some((issue) => issue.path[0] === "password");
    const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
    if (passwordIssue) return errorResponse(400, "密码至少 8 位，且必须包含字母和数字");
    if (emailIssue) return errorResponse(400, "邮箱格式不正确");
    return errorResponse(400, "请求格式无效");
  }

  const input = parsed.data;
  const configuredInviteCode = process.env.REGISTRATION_INVITE_CODE;
  const hasInviteCode = !!input.inviteCode;
  if (hasInviteCode && (!configuredInviteCode || input.inviteCode !== configuredInviteCode)) {
    return errorResponse(400, "邀请码无效");
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    if (error instanceof RangeError) return errorResponse(400, "密码不能超过 72 字节");
    throw error;
  }

  const status = hasInviteCode ? "ACTIVE" : "PENDING";
  const metadata = requestMetadata(request);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existingUser) {
        await tx.auditLog.create({
          data: {
            actorId: SYSTEM_USER_ID,
            action: "USER_REGISTRATION_REJECTED",
            entityType: "RegistrationAttempt",
            entityId: randomUUID(),
            after: { email: maskEmail(input.email), reason: "duplicate_email" },
            ip: metadata.ip,
            userAgent: metadata.userAgent,
          },
        });
        return null;
      }

      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, status },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "USER_REGISTERED",
          entityType: "User",
          entityId: user.id,
          after: { email: maskEmail(input.email), role: "MEMBER", status: user.status },
          ip: metadata.ip,
          userAgent: metadata.userAgent,
        },
      });
      return user;
    });

    if (!result) return errorResponse(409, "无法完成注册");
    return NextResponse.json({
      message: result.status === "ACTIVE" ? "注册成功，请登录" : "注册成功，等待管理员激活",
      status: result.status,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(409, "无法完成注册");
    }
    throw error;
  }
}
