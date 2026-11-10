import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  auditFails: false,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.db;
  },
}));
import {
  registerScanIssues,
  changeIssue,
  auditReport,
} from "@/modules/audit/issue-service";
import { listIssues, findIssue } from "@/modules/audit/issue-repositories";
import { renderAuditReport } from "@/modules/audit/report";
import { reviewFinding } from "@/modules/ai/compliance-audit/review-service";
import type { IssueCommand } from "@/modules/audit/issue-schema";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
const db = new PrismaClient();
state.db = db.$extends({
  query: {
    auditLog: {
      create: async ({ args, query }) => {
        if (state.auditFails) throw new Error("Synthetic audit outage");
        return query(args);
      },
    },
  },
});
let pm: string,
  qa: string,
  member: string,
  outsider: string,
  projectId: string,
  taskId: string,
  documentId: string,
  issueId: string;
const actor = (actorId = qa) => ({
  actorId,
  ip: "127.0.0.1",
  userAgent: "Synthetic audit integration",
});
const user = (id: string, role: AuthenticatedUser["role"]) =>
  ({ id, role }) as AuthenticatedUser;
const finding = () => ({
  code: "TASK_WITHOUT_REQUIREMENT",
  findingKey: `TASK_WITHOUT_REQUIREMENT:${taskId}:0`,
  summary: "Synthetic task lacks requirement",
  recordIds: [taskId],
  auditIds: [],
  requirementVersion: null,
  sourceAuditMissing: true,
});
async function scan() {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Project WHERE id=${projectId} FOR UPDATE`;
    const summary = await tx.aiSuggestion.create({
      data: { projectId, type: "AUDIT_SUMMARY", input: {}, output: {} },
    });
    return registerScanIssues(tx, projectId, summary.id, [finding()], actor());
  });
}
async function act(
  action: IssueCommand["action"],
  actorId = qa,
  extra: Partial<IssueCommand> = {},
) {
  const row = await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } });
  return changeIssue(
    issueId,
    {
      action,
      expectedRowVersion: row.rowVersion,
      note: `Synthetic ${action}`,
      evidenceIds: [],
      ...extra,
    },
    actor(actorId),
  );
}
async function assign() {
  await act("CONFIRM");
  await act("ASSIGN", pm, {
    assignedToId: member,
    dueDate: "2099-01-01T00:00:00Z",
  });
}
describe.sequential("audit remediation real MySQL evidence lifecycle", () => {
  beforeAll(async () => {
    if (
      !/^medpm_test_ia_/.test(
        new URL(process.env.DATABASE_URL!).pathname.slice(1),
      )
    )
      throw new Error("Isolated database required");
    if (!(await db.auditIssue.count()))
      for (const file of ["rollback.sql", "migration.sql", "migration.sql"])
        execFileSync(
          process.execPath,
          [
            "node_modules/prisma/build/index.js",
            "db",
            "execute",
            "--file",
            `prisma/migrations/20261101000000_audit_remediation/${file}`,
            "--schema",
            "prisma/schema.prisma",
          ],
          { env: process.env, stdio: "pipe", windowsHide: true },
        );
    [pm, qa, member, outsider] = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const role of ["PM", "QA", "MEMBER", "QA"] as const)
        ids.push(
          (
            await tx.user.create({
              data: {
                name: `Synthetic ${role}`,
                email: `${randomUUID()}@medpm.local`,
                passwordHash: "not-a-real-password",
                status: "ACTIVE",
                role,
              },
            })
          ).id,
        );
      return ids;
    });
  });
  beforeEach(async () => {
    state.auditFails = false;
    await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name: "Synthetic audit <script>fixture</script>",
          ownerId: pm,
          status: "ACTIVE",
        },
      });
      projectId = p.id;
      await tx.projectMember.createMany({
        data: [qa, member].map((userId) => ({ projectId, userId })),
      });
      taskId = (
        await tx.task.create({
          data: { projectId, title: "Synthetic unlinked task" },
        })
      ).id;
      documentId = (
        await tx.document.create({
          data: {
            projectId,
            filename: "Synthetic remediation.txt",
            mediaType: "text/plain",
            fileSize: 10,
            minioKey: `synthetic/${randomUUID()}`,
            sha256: "a".repeat(64),
            storageStatus: "AVAILABLE",
            uploadedById: pm,
            visibleRoles: ["QA", "PM", "MEMBER"],
          },
        })
      ).id;
    });
    issueId = (await scan())[0].issueId;
  });
  afterAll(() => db.$disconnect());
  it("deduplicates repeated scans while preserving occurrences and human decisions", async () => {
    await act("CONFIRM");
    await scan();
    expect(await db.auditIssue.count({ where: { projectId } })).toBe(1);
    expect(await db.auditIssueOccurrence.count({ where: { issueId } })).toBe(2);
    expect(
      (await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } }))
        .status,
    ).toBe("OPEN");
  });
  it("enforces role, project scope, assignee, document visibility and optimistic concurrency", async () => {
    await expect(act("CONFIRM", pm)).rejects.toMatchObject({ status: 403 });
    await expect(act("CONFIRM", outsider)).rejects.toMatchObject({
      status: 403,
    });
    expect(await listIssues(user(outsider, "QA"), projectId)).toHaveLength(0);
    expect(await findIssue(user(member, "MEMBER"), issueId)).toBeNull();
    await assign();
    await expect(
      act("SUBMIT", pm, { evidenceIds: [documentId] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeIssue(
        issueId,
        {
          action: "SUBMIT",
          expectedRowVersion: 1,
          note: "Stale",
          evidenceIds: [documentId],
        },
        actor(member),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) =>
      tx.document.update({
        where: { id: documentId },
        data: { visibleRoles: ["PM"] },
      }),
    );
    await expect(
      act("SUBMIT", member, { evidenceIds: [documentId] }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires evidence, blocks closure while rule still fails and closes after actual correction", async () => {
    await assign();
    await expect(act("SUBMIT", member)).rejects.toMatchObject({ status: 400 });
    await act("SUBMIT", member, { evidenceIds: [documentId] });
    await expect(act("CLOSE")).rejects.toMatchObject({ status: 409 });
    await db.$transaction(async (tx) => {
      const req = await tx.requirement.create({
        data: {
          projectId,
          title: "Synthetic corrected requirement",
          content: "Synthetic",
        },
      });
      await tx.task.update({
        where: { id: taskId },
        data: { requirementId: req.id, reviewedRequirementVersion: 1 },
      });
    });
    await act("CLOSE");
    const row = await db.auditIssue.findUniqueOrThrow({
      where: { id: issueId },
    });
    expect(row.status).toBe("CLOSED");
    const event = await db.auditIssueEvent.findFirstOrThrow({
      where: { issueId, action: "CLOSE" },
    });
    expect(event.evidence).toMatchObject({
      verification: { result: "PASSED" },
    });
    await scan();
    expect(
      (await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } }))
        .status,
    ).toBe("CLOSED");
    await act("REOPEN");
    expect(
      (await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } }))
        .status,
    ).toBe("OPEN");
  });
  it("rejects changed evidence, supports return and records immutable historical submissions", async () => {
    await assign();
    await act("SUBMIT", member, { evidenceIds: [documentId] });
    await db.$transaction((tx) =>
      tx.document.update({
        where: { id: documentId },
        data: { sha256: "b".repeat(64) },
      }),
    );
    await expect(act("CLOSE")).rejects.toMatchObject({ status: 409 });
    await act("RETURN");
    expect(
      await db.auditIssueEvent.count({ where: { issueId, action: "SUBMIT" } }),
    ).toBe(1);
    await expect(
      db.$executeRaw`UPDATE AuditIssueEvent SET note='tampered' WHERE issueId=${issueId}`,
    ).rejects.toThrow("ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE");
    await expect(
      db.$executeRaw`DELETE FROM AuditIssueOccurrence WHERE issueId=${issueId}`,
    ).rejects.toThrow("ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE");
  });
  it("rolls back state, event and export on audit failure", async () => {
    state.auditFails = true;
    await expect(act("CONFIRM")).rejects.toThrow("Synthetic audit outage");
    expect(
      (await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } }))
        .status,
    ).toBe("PENDING");
    expect(await db.auditIssueEvent.count({ where: { issueId } })).toBe(0);
    await expect(auditReport(actor(), projectId)).rejects.toThrow(
      "Synthetic audit outage",
    );
  });
  it("commits a competing QA decision once and rejects empty hashes", async () => {
    const row = await db.auditIssue.findUniqueOrThrow({
      where: { id: issueId },
    });
    const command = {
      action: "CONFIRM" as const,
      expectedRowVersion: row.rowVersion,
      note: "Synthetic competing review",
      evidenceIds: [],
    };
    const results = await Promise.allSettled([
      changeIssue(issueId, command, actor()),
      changeIssue(issueId, command, actor()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.auditIssueEvent.count({ where: { issueId, action: "CONFIRM" } }),
    ).toBe(1);
    await act("ASSIGN", pm, {
      assignedToId: member,
      dueDate: "2099-01-01T00:00:00Z",
    });
    await db.$transaction((tx) =>
      tx.document.update({ where: { id: documentId }, data: { sha256: null } }),
    );
    await expect(
      act("SUBMIT", member, { evidenceIds: [documentId] }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("links legacy summary review to the persistent issue without rewriting historical summaries", async () => {
    const summary = await db.$transaction((tx) =>
      tx.aiSuggestion.create({
        data: {
          projectId,
          type: "AUDIT_SUMMARY",
          input: {},
          output: { findings: [finding()] },
        },
      }),
    );
    await reviewFinding(
      summary.id,
      finding().findingKey,
      { decision: "CONFIRMED", note: "Synthetic legacy finding review" },
      actor(),
    );
    expect(await db.auditIssueOccurrence.count({ where: { issueId } })).toBe(2);
    expect(
      (await db.auditIssue.findUniqueOrThrow({ where: { id: issueId } }))
        .status,
    ).toBe("OPEN");
    expect(
      (await db.aiSuggestion.findUniqueOrThrow({ where: { id: summary.id } }))
        .output,
    ).toEqual({ findings: [finding()] });
  });
  it("exports escaped readable history with a tracked project scope and no PM export permission", async () => {
    await expect(auditReport(actor(pm), projectId)).rejects.toMatchObject({
      status: 403,
    });
    const report = await auditReport(actor(), projectId);
    const html = renderAuditReport(report);
    expect(html).toContain("审计整改报告");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(report.issues).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { projectId, action: "AUDIT_REPORT_EXPORTED" },
      }),
    ).toBe(1);
  });
});
