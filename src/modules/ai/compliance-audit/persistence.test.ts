import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    task: { findMany: vi.fn() },
    requirement: { findMany: vi.fn() },
    testCase: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => { throw new Error("LLM is not configured"); } }));

import { prisma } from "@/lib/prisma";
import { runComplianceAudit } from "./service";

const tx = {
  auditLog: { create: vi.fn() },
  task: { findMany: vi.fn() },
  requirement: { findMany: vi.fn() },
  testCase: { findMany: vi.fn() },
};
const db = prisma as unknown as {
  auditLog: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("compliance audit persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.auditLog.findMany.mockResolvedValue([]);
    tx.task.findMany.mockResolvedValue([]);
    tx.requirement.findMany.mockResolvedValue([]);
    tx.testCase.findMany.mockResolvedValue([]);
    tx.auditLog.create.mockResolvedValue({ id: "summary-audit-id" });
    db.$transaction.mockImplementation((operation: (client: typeof tx) => unknown) => Promise.resolve(operation(tx)));
  });

  it("writes the generated summary and fallback mode as an audit event", async () => {
    const result = await runComplianceAudit({ projectId: "00000000-0000-4000-8000-000000000010", actorId: "00000000-0000-4000-8000-000000000011" });
    expect(result.degraded).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "AI_AUDIT_SUMMARY_GENERATED",
      entityType: "AuditSummary",
      after: expect.objectContaining({ result: "RULE_BASED_FALLBACK", summary: expect.objectContaining({ overview: expect.any(String) }) }),
    }) }));
  });
});
