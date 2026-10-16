import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const findProject = (tx: Prisma.TransactionClient, id: string) => tx.project.findUnique({ where: { id }, select: { id: true } });
export const findRequirement = (tx: Prisma.TransactionClient, projectId: string, id: string) => tx.requirement.findFirst({ where: { id, projectId } });
export const findTestCase = (tx: Prisma.TransactionClient, projectId: string, id: string) => tx.testCase.findFirst({ where: { id, requirement: { projectId } } });
export const findTask = (tx: Prisma.TransactionClient, projectId: string, id: string) => tx.task.findFirst({ where: { id, projectId } });
export const insertProject = (tx: Prisma.TransactionClient, data: Prisma.ProjectUncheckedCreateInput) => tx.project.create({ data });
export const insertRequirement = (tx: Prisma.TransactionClient, data: Prisma.RequirementUncheckedCreateInput) => tx.requirement.create({ data });
export const insertTestCase = (tx: Prisma.TransactionClient, data: Prisma.TestCaseUncheckedCreateInput) => tx.testCase.create({ data });
export const updateRequirement = (tx: Prisma.TransactionClient, args: Prisma.RequirementUpdateManyArgs) => tx.requirement.updateMany(args);
export const updateTestCase = (tx: Prisma.TransactionClient, args: Prisma.TestCaseUpdateManyArgs) => tx.testCase.updateMany(args);
export const updateTaskRequirement = (tx: Prisma.TransactionClient, args: Prisma.TaskUpdateManyArgs) => tx.task.updateMany(args);

export async function loadTraceability(projectId: string) {
  return prisma.$transaction(async (tx) => {
    if (!await findProject(tx, projectId)) return null;
    const requirements = await tx.requirement.findMany({ where: { projectId }, include: { testCases: { orderBy: { createdAt: "asc" } } }, orderBy: [{ title: "asc" }, { version: "desc" }] });
    const tasks = await tx.task.findMany({ where: { projectId }, select: { id: true, title: true, requirementId: true, updatedAt: true, reviewedRequirementVersion: true, requirementReviewedAt: true }, orderBy: { title: "asc" } });
    return { requirements, tasks };
  });
}
