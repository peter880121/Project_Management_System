import { describe, it, expect } from "vitest";
import { canReadDocument } from "./access";
const publicRoles = ["ADMIN", "PM", "QA", "MEMBER"];
describe("meeting attachment read scope", () => {
  it("keeps ordinary documents compatible", () => {
    expect(canReadDocument({ visibleRoles: publicRoles }, "MEMBER")).toBe(true);
    expect(canReadDocument({ visibleRoles: ["PM"] }, "QA")).toBe(false);
  });
  it("hides public draft attachments from QA and MEMBER even with a direct document ID", () => {
    const doc = { projectId: "p", visibleRoles: publicRoles, meetingAttachment: { projectId: "p", visibleRoles: publicRoles, status: "DRAFT" } };
    expect(canReadDocument(doc, "PM")).toBe(true); expect(canReadDocument(doc, "ADMIN")).toBe(true);
    expect(canReadDocument(doc, "QA")).toBe(false); expect(canReadDocument(doc, "MEMBER")).toBe(false);
    expect(canReadDocument({ ...doc, meetingAttachment: { ...doc.meetingAttachment, status: "FINALIZED" } }, "QA")).toBe(true);
  });
  it("checks the meeting's actual role scope and project in addition to document metadata", () => {
    const doc = { projectId: "p", visibleRoles: publicRoles, meetingAttachment: { projectId: "p", visibleRoles: ["PM"], status: "FINALIZED" } };
    expect(canReadDocument(doc, "QA")).toBe(false); expect(canReadDocument(doc, "ADMIN")).toBe(true);
    expect(canReadDocument({ ...doc, meetingAttachment: { ...doc.meetingAttachment, projectId: "other" } }, "ADMIN")).toBe(false);
  });
});
