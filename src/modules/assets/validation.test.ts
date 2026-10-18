import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { deliverableCreateSchema, deliverableEditSchema, reviewSchema, meetingSchema, canReadRoles } from "./validation";
it("rejects status injection into create/edit and malformed review decisions", () => {
  expect(deliverableCreateSchema.safeParse({ name: "Report", documentId: randomUUID(), status: "APPROVED" }).success).toBe(false);
  expect(deliverableEditSchema.safeParse({ name: "Report", rowVersion: 1, status: "APPROVED" }).success).toBe(false);
  expect(reviewSchema.safeParse({ decision: "REJECTED", rowVersion: 1 }).success).toBe(false);
  expect(reviewSchema.safeParse({ decision: "APPROVED", rowVersion: 1 }).success).toBe(true);
});
it("requires structured action items and explicit valid visibility roles", () => {
  const data = { title: "Synthetic meeting", meetingDate: new Date().toISOString(), content: "Synthetic minutes", requestKey: randomUUID(), visibleRoles: ["PM"], actionItems: [{ id: randomUUID(), text: "Prepare report", checked: false }] };
  expect(meetingSchema.safeParse(data).success).toBe(true);
  expect(meetingSchema.safeParse({ ...data, actionItems: [{ text: "Bad" }] }).success).toBe(false);
  expect(meetingSchema.safeParse({ ...data, visibleRoles: ["PM", "PM"] }).success).toBe(false);
  expect(canReadRoles(["PM"], "MEMBER")).toBe(false); expect(canReadRoles(["PM"], "PM")).toBe(true); expect(canReadRoles(["PM"], "ADMIN")).toBe(true);
});
