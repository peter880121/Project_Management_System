import type { AuditRequestMetadata } from "./service";

export function getAuditRequestMetadata(request: Request): AuditRequestMetadata {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return {
    ip: (request.headers.get("x-real-ip") ?? forwardedFor?.split(",")[0]?.trim() ?? null)?.slice(0, 45) ?? null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}
