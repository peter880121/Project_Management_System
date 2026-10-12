import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const id = (value) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const now = new Date("2026-10-12T00:00:00.000Z");

const users = [
  { id: id(1), email: "admin@example.test", name: "Synthetic Admin", role: "ADMIN" },
  { id: id(2), email: "pm@example.test", name: "Synthetic Project Manager", role: "PM" },
  { id: id(3), email: "member@example.test", name: "Synthetic Engineer", role: "MEMBER" },
  { id: id(4), email: "qa@example.test", name: "Synthetic QA", role: "QA" },
];

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
    dueDate: new Date(Date.UTC(2026, 10 + Math.floor(index / 12), (index % 25) + 1)),
  };
});

async function main() {
  await prisma.$transaction(async (tx) => {
    for (const user of users) {
      await tx.user.upsert({ where: { id: user.id }, create: user, update: { email: user.email, name: user.name, role: user.role } });
    }

    for (const project of projects) {
      await tx.project.upsert({ where: { id: project.id }, create: project, update: project });
    }

    for (const task of tasks) {
      await tx.task.upsert({ where: { id: task.id }, create: task, update: task });
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
          update: { title, content: "Synthetic requirement for software delivery traceability; no patient or production data is included.", status: "APPROVED" },
        });

        const testCaseId = id(401 + projectIndex * 2 + requirementIndex);
        await tx.testCase.upsert({
          where: { id: testCaseId },
          create: { id: testCaseId, requirementId, title: `Verify synthetic requirement ${requirementIndex + 1}`, status: "NOT_RUN" },
          update: { title: `Verify synthetic requirement ${requirementIndex + 1}`, status: "NOT_RUN" },
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
        update: { filename: "synthetic-release-brief.txt", parsedText: "Synthetic project brief for demonstration only. No patient information." },
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
        update: { status: "PENDING", reviewedById: null, reviewedAt: null },
      });
    }

    for (let index = 0; index < tasks.length; index += 1) {
      const requirementId = id(201 + Math.floor(index / 8) * 2 + (index % 8 < 4 ? 0 : 1));
      await tx.task.update({ where: { id: tasks[index].id }, data: { requirementId } });
    }

    for (let index = 0; index < 10; index += 1) {
      const task = tasks[index];
      await tx.auditLog.upsert({
        where: { id: id(501 + index) },
        create: {
          id: id(501 + index),
          actorId: id(index % 2 === 0 ? 2 : 4),
          action: "TASK_STATUS_CHANGED",
          entityType: "Task",
          entityId: task.id,
          before: { status: task.status === "TODO" ? "IN_PROGRESS" : "TODO" },
          after: { status: task.status },
          ip: "192.0.2.10",
          userAgent: "MedPM-AI synthetic seed",
          createdAt: now,
        },
        update: { actorId: id(index % 2 === 0 ? 2 : 4), after: { status: task.status } },
      });
    }
  }, { maxWait: 10_000, timeout: 30_000 });

}

main()
  .catch((error) => {
    console.error("Seed failed; transaction rolled back.", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
