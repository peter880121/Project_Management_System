import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { generationId, generationResponse } from "@/modules/ai/streaming/response";
import { generateAcceptanceDiagnosis } from "@/modules/ai/acceptance-check/service";
import { assertCheckFresh, checkDto, createComplianceCheck, currentRules } from "@/modules/projects/acceptance-check/service";
import { readDetails } from "@/modules/projects/acceptance-check/repository";
import { ruleSchema } from "@/modules/projects/acceptance-check/types";
import { projectErrorResponse } from "@/modules/projects/http";
import { lockProject } from "@/modules/auth/transaction-locks";
import { assertProjectAccessTx } from "@/modules/auth/project-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
function validOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin"); if (!origin) return true;
  try { const url = new URL(origin); const host = new URL(`http://${request.headers.get("host") ?? new URL(request.url).host}`).host; return ["http:", "https:"].includes(url.protocol) && url.host === host; } catch { return false; }
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => {
    // Same-origin authenticated API. Do not enable wildcard CORS on an AI-costing operation.
    // Next's internal request URL can use localhost while the browser uses 127.0.0.1.
    // Host is the actual browser-facing authority; never accept an arbitrary Origin or wildcard CORS.
    if (!validOrigin(request)) return Response.json({ error: "不允许跨站发起体检" }, { status: 403 });
    z.object({}).strict().parse(await request.json());
    try {
      const id = generationId(request); const metadata = getAuditRequestMetadata(request);
      const check = await createComplianceCheck(projectId, id, { actorId: user.id, ...metadata });
      if (check.passed) return Response.json({ passed: true, message: "合规检查通过，可提交验收" }, { headers: { "X-Check-Id": check.id, "X-Evidence-Fingerprint": check.fingerprint, "Cache-Control": "no-store" } });
      return generationResponse(request, { generationId: id, projectId, actorId: user.id, ...metadata }, stream => generateAcceptanceDiagnosis(check, stream, metadata));
    } catch (error) { return projectErrorResponse(error); }
  }, request);
}
export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => {
    const query = new URL(request.url).searchParams; const id = z.uuid().parse(query.get("checkId"));
    const rule = query.has("rule") ? ruleSchema.parse(query.get("rule")) : null; const page = z.coerce.number().int().min(1).max(100000).parse(query.get("page") ?? 1);
    try {
      const result = await prisma.$transaction(async tx => {
        await lockProject(tx, projectId); await assertProjectAccessTx(tx, user.id, projectId);
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        const check = await assertCheckFresh(tx, projectId, id, user.id, await currentRules(tx, projectId), project.rowVersion);
        const diagnosis = await tx.aiSuggestion.findFirst({ where: { id, projectId, type: "ACCEPTANCE_DIAGNOSIS" }, select: { output: true } });
        return { data: diagnosis?.output ?? checkDto(check), details: rule ? await readDetails(tx, projectId, rule, user.role, page) : [], page, pageSize: 20 };
      }, { timeout: 15000 }); return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return projectErrorResponse(error); }
  });
}
