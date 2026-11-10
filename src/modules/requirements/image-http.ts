import { z } from "zod";
import { ProjectError } from "@/modules/projects/services";
import { MAX_IMAGE_BYTES } from "./images";
export async function readImageUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;.*boundary=/i.test(contentType)) throw new ProjectError("请使用文件上传表单提交图片", 400);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 65536) throw new ProjectError("每张图片需在 5 MB 以内", 413);
  // Bound the stream before multipart parsing, including requests with no Content-Length.
  const reader = request.body?.getReader(); if (!reader) throw new ProjectError("请选择图片", 400);
  const parts: Uint8Array[] = []; let total = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_IMAGE_BYTES + 65536) { await reader.cancel(); throw new ProjectError("每张图片需在 5 MB 以内", 413); } parts.push(value); } } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(parts), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new ProjectError("图片上传表单无效", 400); }
  const file = form.get("file"); if (!(file instanceof File)) throw new ProjectError("请选择图片", 400);
  return { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()), expectedRowVersion: z.coerce.number().int().positive().parse(form.get("expectedRowVersion")) };
}
