import { describe, it, expect, vi, afterEach } from "vitest";
import { meetingUploadSelection, uploadMeetingFiles } from "./meeting-attachments";
afterEach(() => vi.unstubAllGlobals());
describe("meeting attachment selection and partial failure handling", () => {
  it("accepts supported files and bounds each selection", () => {
    const entries = meetingUploadSelection([new File(["synthetic"], "纪要.md")]); expect(entries).toHaveLength(1); expect(entries[0].uploadKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(() => meetingUploadSelection([new File(["x"], "bad.exe")])).toThrow();
    expect(() => meetingUploadSelection(Array.from({ length: 11 }, () => new File(["x"], "a.txt")))).toThrow();
  });
  it("retains failed files and their idempotency keys without repeating successful uploads", async () => {
    const entries = meetingUploadSelection([new File(["one"], "first.txt"), new File(["two"], "second.md")]);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { id: "saved" } }, { status: 201 })).mockResolvedValueOnce(Response.json({ error: "synthetic storage unavailable" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
    const result = await uploadMeetingFiles("project", "meeting", entries); expect(result.saved).toBe(1); expect(result.failed).toEqual([entries[1]]); expect(result.errors[0]).toContain("second.md");
    const form = fetcher.mock.calls[1][1].body as FormData; expect(form.get("uploadKey")).toBe(entries[1].uploadKey); expect(form.get("syntheticOnly")).toBe("true"); expect(fetcher.mock.calls[1][0]).toBe("/api/projects/project/meetings/meeting/attachments");
    fetcher.mockResolvedValue(Response.json({ data: { id: "saved" } }, { status: 201 })); expect((await uploadMeetingFiles("project", "meeting", result.failed)).saved).toBe(1); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
