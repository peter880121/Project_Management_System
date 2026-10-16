import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, readUpload, validatePdf } from "./validation";
const pdf = Buffer.from("%PDF-1.4\nSynthetic file fixture\n%%EOF\n");
describe("PDF upload validation", () => {
  it("hashes accepted bytes and rejects unsafe filenames, MIME and disguised files", () => {
    expect(validatePdf("合成需求.pdf", "application/pdf", pdf)).toMatchObject({ fileSize: pdf.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const name of ["../a.pdf", "a\\b.pdf", "a\n.pdf", "a.txt"]) expect(() => validatePdf(name, "application/pdf", pdf)).toThrow();
    expect(() => validatePdf("a.pdf", "text/plain", pdf)).toThrow();
    expect(() => validatePdf("a.pdf", "application/pdf", Buffer.from("fake"))).toThrow();
    expect(() => validatePdf("a.pdf", "application/pdf", Buffer.alloc(MAX_PDF_BYTES + 1))).toThrow();
  });
  it("requires a unique upload key and explicit synthetic-data confirmation", async () => {
    const form = new FormData(); form.set("file", new File([pdf], "a.pdf", { type: "application/pdf" })); form.set("uploadKey", randomUUID()); form.set("syntheticOnly", "true");
    expect((await readUpload(new Request("http://localhost/upload", { method: "POST", body: form }))).bytes).toEqual(pdf);
    form.set("syntheticOnly", "false");
    await expect(readUpload(new Request("http://localhost/upload", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
    form.set("syntheticOnly", "true"); form.append("uploadKey", randomUUID());
    await expect(readUpload(new Request("http://localhost/upload", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
  });
  it("enforces actual body length even without a Content-Length header", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PDF_BYTES + 65537)); controller.close(); } });
    await expect(readUpload(new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit))).rejects.toMatchObject({ status: 413 });
  });
});
