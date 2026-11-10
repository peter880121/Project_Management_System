import { describe, expect, it, vi } from "vitest";
import { actionSchema, createRequirementSchema, editRequirementSchema, intakeActionSchema, baselineSchema } from "./schemas";
import { validateRequirementImage, MAX_IMAGE_BYTES } from "./images";
import { evidenceHash } from "./services";
import { readImageUpload } from "./image-http";
const id = "00000000-0000-4000-8000-000000000002";
const draft = { title: "Synthetic requirement", content: "Synthetic workflow", acceptanceCriteria: "Verify expected synthetic behavior", dueDate: "2026-10-31", requestKey: id };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+ZkAAAAASUVORK5CYII=", "base64");
describe("requirements input and evidence boundaries", () => {
  it("rejects invalid multipart requests and oversized bodies before parsing uploads", async () => {
    await expect(readImageUpload(new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ status: 400 });
    await expect(readImageUpload(new Request("http://localhost", { method: "POST", body: "synthetic", headers: { "content-type": "multipart/form-data; boundary=synthetic", "content-length": String(MAX_IMAGE_BYTES + 65537) } }))).rejects.toMatchObject({ status: 413 });
  });
  it("requires a real planned date and acceptance criteria, without accepting workflow overrides", () => {
    expect(createRequirementSchema.parse(draft).dueDate).toBe("2026-10-31");
    for (const dueDate of ["", "2026-02-30", "2026-10-31T00:00:00Z", undefined]) expect(createRequirementSchema.safeParse({ ...draft, dueDate }).success).toBe(false);
    expect(createRequirementSchema.safeParse({ ...draft, workflowState: "CLOSED", completedAt: "2026-10-01" }).success).toBe(false);
    expect(createRequirementSchema.safeParse({ ...draft, acceptanceCriteria: "" }).success).toBe(false);
  });
  it("requires a concurrency version for edits and guards completion dates using the business calendar", () => {
    const fields = { title: draft.title, content: draft.content, acceptanceCriteria: draft.acceptanceCriteria, dueDate: draft.dueDate };
    expect(editRequirementSchema.safeParse(fields).success).toBe(false);
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T16:00:00.000Z"));
    try { expect(actionSchema.safeParse({ expectedRowVersion: 1, requestKey: id, completedAt: "2026-10-21" }).success).toBe(true); expect(actionSchema.safeParse({ expectedRowVersion: 1, requestKey: id, completedAt: "2026-10-22" }).success).toBe(false); } finally { vi.useRealTimers(); }
  });
  it("requires disposition reasons and forbids duplicate baseline references", () => {
    expect(intakeActionSchema.safeParse({ state: "REJECTED", expectedRowVersion: 1, reason: "" }).success).toBe(false);
    expect(baselineSchema.safeParse({ name: "V1", requirementIds: [id, id] }).success).toBe(false);
  });
  it("checks actual image bytes, extension and size rather than trusting browser MIME", () => {
    expect(validateRequirementImage("synthetic.png", png).mediaType).toBe("image/png");
    for (const [name, bytes] of [["fake.png", Buffer.from("<svg onload='bad()'/>")], ["real.svg", png], ["wrong.jpg", png], ["../bad.png", png], ["oversize.png", Buffer.alloc(MAX_IMAGE_BYTES + 1)]] as const) expect(() => validateRequirementImage(name, bytes)).toThrow();
  });
  it("hashes JSON independently of MySQL object key ordering", () => {
    expect(evidenceHash([{ version: 1, nested: { a: 1, b: 2 } }])).toBe(evidenceHash([{ nested: { b: 2, a: 1 }, version: 1 }]));
  });
});
