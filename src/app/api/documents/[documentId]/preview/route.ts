import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentId, DocumentError } from "@/modules/documents/validation";
import { findDocument } from "@/modules/documents/repositories";
import { previewParseJob } from "@/modules/documents/parse-repositories";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentHttp(documentReaders, async () => {
    const id = documentId((await context.params).documentId);
    const params = z.object({ version: z.coerce.number().int().positive().optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!params.success) throw new DocumentError("版本参数无效", 400);
    const document = await findDocument(id); if (!document) throw new DocumentError("文档不存在", 404);
    const version = params.data.version ?? document.parsedVersion;
    if (!version) throw new DocumentError("文档尚无成功解析版本", 409);
    const job = await previewParseJob(id, version);
    if (!job || job.status !== "SUCCEEDED") throw new DocumentError("解析结果尚不可用", 409);
    const markdown = job.markdown ?? "";
    const blocks = Array.isArray(job.blocks) ? job.blocks : [];
    const previewBlocks = blocks.slice(0, 200).map((block) => {
      if (block && typeof block === "object" && !Array.isArray(block) && typeof block.text === "string") return { ...block, text: block.text.slice(0, 2000) };
      return block;
    });
    return Response.json({ data: { ...job, markdown: markdown.slice(0, 200000), blocks: previewBlocks, totalBlocks: blocks.length, previewTruncated: markdown.length > 200000 || blocks.length > 200 || blocks.some((block) => block && typeof block === "object" && !Array.isArray(block) && typeof block.text === "string" && block.text.length > 2000) } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export const GET = projectScoped(GETHandler);
