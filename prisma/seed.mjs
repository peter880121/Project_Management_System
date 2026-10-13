import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

if (process.env.NODE_ENV === "production") {
  throw new Error("seed 禁止在 production 运行");
}

const prisma = new PrismaClient();
const id = (value) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const now = new Date("2026-10-12T00:00:00.000Z");

const systemUserId = "00000000-0000-4000-8000-0000000000f0";
const systemUserEmail = "auth-service@medpm.local";
const seedPassword = process.env.LOCAL_DEV_SEED_PASSWORD;

const projects = [
  { id: id(101), name: "Atlas Release Readiness", description: "Synthetic example: prepare a fictional scheduling product for a controlled release." },
  { id: id(102), name: "Beacon Validation Upgrade", description: "Synthetic example: improve validation and traceability in a fictional software product." },
  { id: id(103), name: "Cedar Security Hardening", description: "Synthetic example: deliver security improvements for a fictional internal platform." },
].map((project) => ({ ...project, ownerId: id(2), status: "ACTIVE" }));

const tasks = Array.from({ length: 24 }, (_, index) => {
  const project = projects[Math.floor(index / 8)];
  const state = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"][index % 4];
  return {
    id: id(1001 + index),
    projectId: project.id,
    assigneeId: index % 2 === 0 ? id(3) : id(4),
    title: `${project.name.split(" ")[0]} delivery task ${String(index % 8 + 1).padStart(2, "0")}`,
    description: "Synthetic delivery work item. Contains no patient or production data.",
    status: state,
    estimateHours: 2 + (index % 7) * 1.5,
    actualHours: state === "DONE" ? 4 + (index % 6) * 1.25 : null,
    completedAt: state === "DONE" ? new Date("2026-10-12T00:00:00.000Z") : null,
    dueDate: new Date(Date.UTC(2026, 10 + Math.floor(index / 12), (index % 25) + 1)),
    createdAt: new Date(Date.UTC(2026, 8, 1 + index)),
  };
});

async function main() {
  if (!seedPassword || seedPassword.length < 8) {
    throw new Error("Set LOCAL_DEV_SEED_PASSWORD to a value of at least 8 characters before seeding.");
  }

  // Hash before opening the transaction to avoid holding database locks while bcrypt runs.
  const userPasswordHash = await bcrypt.hash(seedPassword, 12);
  const systemPasswordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
  const users = [
    { id: id(1), email: "admin@medpm.local", name: "Synthetic Admin", role: "ADMIN", passwordHash: userPasswordHash, status: "ACTIVE", isSystem: false },
    { id: id(2), email: "pm@medpm.local", name: "Synthetic Project Manager", role: "PM", passwordHash: userPasswordHash, status: "ACTIVE", isSystem: false },
    { id: id(3), email: "member@medpm.local", name: "Synthetic Engineer", role: "MEMBER", passwordHash: userPasswordHash, status: "ACTIVE", isSystem: false },
    { id: id(4), email: "qa@medpm.local", name: "Synthetic QA", role: "QA", passwordHash: userPasswordHash, status: "ACTIVE", isSystem: false },
    { id: id(5), email: "pending@medpm.local", name: "Synthetic Pending User", role: "MEMBER", passwordHash: userPasswordHash, status: "PENDING", isSystem: false },
    { id: id(6), email: "disabled@medpm.local", name: "Synthetic Disabled User", role: "MEMBER", passwordHash: userPasswordHash, status: "DISABLED", isSystem: false },
    { id: systemUserId, email: systemUserEmail, name: "MedPM authentication service", role: "MEMBER", passwordHash: systemPasswordHash, status: "DISABLED", isSystem: true },
  ].map((user) => ({ ...user, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null }));

  await prisma.$transaction(async (tx) => {
    const legacySeedEmails = new Map([
      [id(1), "admin@example.test"],
      [id(2), "pm@example.test"],
      [id(3), "member@example.test"],
      [id(4), "qa@example.test"],
    ]);
    for (const user of users) {
      const legacyEmail = legacySeedEmails.get(user.id);
      if (!legacyEmail) continue;
      await tx.user.updateMany({
        where: { id: user.id, email: legacyEmail },
        data: {
          email: user.email,
          name: user.name,
          role: user.role,
          passwordHash: user.passwordHash,
          isSystem: user.isSystem,
          status: user.status,
          lastLoginAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    }

    for (const user of users) {
      const { id: userId, ...data } = user;
      await tx.user.upsert({ where: { id: userId }, create: { id: userId, ...data }, update: {} });
    }

    for (const project of projects) {
      await tx.project.upsert({ where: { id: project.id }, create: project, update: {} });
    }

    for (const task of tasks) {
      await tx.task.upsert({ where: { id: task.id }, create: task, update: {} });
      if (task.status === "DONE") {
        await tx.task.updateMany({ where: { id: task.id, status: "DONE", actualHours: null }, data: { actualHours: task.actualHours, completedAt: task.completedAt, createdAt: task.createdAt } });
      }
    }

    for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
      const project = projects[projectIndex];
      for (let requirementIndex = 0; requirementIndex < 2; requirementIndex += 1) {
        const requirementId = id(201 + projectIndex * 2 + requirementIndex);
        const title = `${project.name.split(" ")[0]} synthetic requirement ${requirementIndex + 1}`;
        await tx.requirement.upsert({
          where: { id: requirementId },
          create: {
            id: requirementId,
            projectId: project.id,
            title,
            content: "Synthetic requirement for software delivery traceability; no patient or production data is included.",
            version: 1,
            status: "APPROVED",
          },
          update: {},
        });

        const testCaseId = id(401 + projectIndex * 2 + requirementIndex);
        await tx.testCase.upsert({
          where: { id: testCaseId },
          create: { id: testCaseId, requirementId, title: `Verify synthetic requirement ${requirementIndex + 1}`, status: "NOT_RUN" },
          update: {},
        });
      }

      const documentId = id(301 + projectIndex);
      await tx.document.upsert({
        where: { id: documentId },
        create: {
          id: documentId,
          projectId: project.id,
          filename: "synthetic-release-brief.txt",
          minioKey: `synthetic-seed/${project.id}/synthetic-release-brief.txt`,
          mediaType: "text/plain",
          parsedText: "Synthetic project brief for demonstration only. No patient information.",
        },
        update: {},
      });

      const suggestionId = id(601 + projectIndex);
      await tx.aiSuggestion.upsert({
        where: { id: suggestionId },
        create: {
          id: suggestionId,
          projectId: project.id,
          type: "WBS",
          input: { source: "synthetic-seed", request: "Break down fictional software delivery work" },
          output: { proposal: ["Review scope", "Implement change", "Verify traceability"], requiresHumanReview: true },
          status: "PENDING",
        },
        update: {},
      });
    }

    for (let index = 0; index < tasks.length; index += 1) {
      const requirementId = id(201 + Math.floor(index / 8) * 2 + (index % 8 < 4 ? 0 : 1));
      await tx.task.updateMany({
        where: { id: tasks[index].id, requirementId: null },
        data: { requirementId },
      });
    }

    await tx.auditLog.createMany({
      data: tasks.slice(0, 10).map((task, index) => ({
        id: id(501 + index),
        actorId: id(index % 2 === 0 ? 2 : 4),
        projectId: task.projectId,
        action: "TASK_STATUS_CHANGED",
        entityType: "Task",
        entityId: task.id,
        before: { status: task.status === "TODO" ? "IN_PROGRESS" : "TODO" },
        after: { status: task.status },
        ip: "192.0.2.10",
        userAgent: "MedPM-AI synthetic seed",
        createdAt: now,
      })),
      skipDuplicates: true,
    });

    const remainingLegacyUsers = await tx.user.findMany({
      where: { email: { endsWith: "@example.test" } },
      select: {
        email: true,
        _count: {
          select: {
            auditLogs: true,
            tasks: true,
            ownedProjects: true,
            reviewedSuggestions: true,
            reviewedRecommendations: true,
          },
        },
      },
    });
    const blockedLegacyUsers = remainingLegacyUsers.flatMap((user) => {
      const references = [
        ["AuditLog.actorId", user._count.auditLogs],
        ["Task.assigneeId", user._count.tasks],
        ["Project.ownerId", user._count.ownedProjects],
        ["AiSuggestion.reviewedById", user._count.reviewedSuggestions],
        ["AIRecommendation.reviewedById", user._count.reviewedRecommendations],
      ]
        .filter(([, count]) => count > 0)
        .map(([relation, count]) => `${relation} (${count})`);
      return references.length > 0 ? [`${user.email}: ${references.join(", ")}`] : [];
    });
    if (blockedLegacyUsers.length > 0) {
      throw new Error(`Cannot remove legacy test users with foreign-key references: ${blockedLegacyUsers.join("; ")}`);
    }
    await tx.user.deleteMany({ where: { email: { endsWith: "@example.test" } } });
  }, { maxWait: 10_000, timeout: 30_000 });

}

main()
  .catch((error) => {
    console.error("Seed failed; transaction rolled back.", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
