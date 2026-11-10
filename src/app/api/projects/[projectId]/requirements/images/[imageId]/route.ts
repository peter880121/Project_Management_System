import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { readRequirementImage } from "@/modules/requirements/images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; imageId: string }> }) {
  const { projectId, imageId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER", "PMO"], async user => {
    z.uuid().parse(imageId); const { image, bytes } = await readRequirementImage(projectId, imageId, { actorId: user.id });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": image.mediaType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}` } });
  });
}
