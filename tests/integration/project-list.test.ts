import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { listProjects } from "@/modules/projects/list-repository";
import { parseProjectListQuery } from "@/modules/projects/list-query";
const db = new PrismaClient(); state.db = db;
let owner: string, member: string, stranger: string, privateId: string; const current: string[] = []; const prefix = `List-${randomUUID()}`;
describe.sequential("project list database filtering and scope", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Isolated database required");
    await db.$transaction(async tx => {
      const user = async (role: "PM" | "MEMBER") => (await tx.user.create({ data: { name: "Synthetic list user", email: `${randomUUID()}@medpm.local`, status: "ACTIVE", role } })).id;
      owner = await user("PM"); member = await user("MEMBER"); stranger = await user("PM");
      for (let i = 0; i < 13; i++) current.push((await tx.project.create({ data: { ownerId: owner, name: `${prefix}-${String(i).padStart(2,"0")}`, description: i === 0 ? "literal_100% description-only-match" : "Synthetic project", status: i % 2 ? "ACTIVE" : "PLANNING", createdAt: new Date("2026-10-01T00:00:00.000Z") } })).id);
      for (const status of ["PENDING_ACCEPTANCE", "ON_HOLD", "ARCHIVED", "CANCELLED", "COMPLETED"] as const) await tx.project.create({ data: { ownerId: owner, name: `${prefix}-${status}`, status } });
      privateId = (await tx.project.create({ data: { ownerId: stranger, name: `${prefix}-private-secret`, status: "ACTIVE" } })).id;
      await tx.projectMember.create({ data: { projectId: current[0], userId: member } });
    });
  });
  afterAll(() => db.$disconnect());
  const load = (params: Record<string, string> = {}, user = { id: owner, role: "PM" as const }) => listProjects(user, parseProjectListQuery(params));
  it("returns only planning/active by default and paginates tied creation dates without overlap", async () => {
    const one = await load(); const two = await load({ page: "2" }); expect(one.total).toBe(13); expect(one.projects).toHaveLength(12); expect(two.projects).toHaveLength(1);
    expect([...one.projects, ...two.projects].map(p => p.id)).toEqual([...current].sort().reverse()); expect(one.allCount).toBe(18); expect(one.counts.ARCHIVED).toBe(1);
  });
  it("supports all and individual statuses including legacy completed", async () => {
    expect((await load({ view: "all" })).total).toBe(18); for (const status of ["ARCHIVED", "CANCELLED", "COMPLETED"]) { const row = await load({ status }); expect(row.total).toBe(1); expect(row.projects[0].status).toBe(status); }
  });
  it("searches descriptions and treats LIKE wildcard characters literally", async () => {
    for (const q of ["description-only-match", "%", "_"]) { const found = await load({ q }); expect(found.total).toBe(1); expect(found.projects[0].id).toBe(current[0]); }
  });
  it("never leaks private matches, counts or creation banners even with forged parameters", async () => {
    const found = await load({ view: "all", q: "private-secret", created: privateId }); expect(found.total).toBe(0); expect(found.allCount).toBe(0); expect(found.counts).toEqual({}); expect(found.created).toBeNull();
  });
  it("restricts members to active membership and removes revoked projects from every aggregate", async () => {
    const user = { id: member, role: "MEMBER" as const }; expect((await listProjects(user, parseProjectListQuery({ view: "all" }))).total).toBe(1);
    await db.$transaction(tx => tx.projectMember.update({ where: { projectId_userId: { projectId: current[0], userId: member } }, data: { active: false } }));
    const found = await listProjects(user, parseProjectListQuery({})); expect(found.total).toBe(0); expect(found.allCount).toBe(0);
  });
  it("clamps pages after data changes and sorts names in the database", async () => {
    expect((await load({ page: "999" })).page).toBe(2); const found = await load({ sort: "name_asc" }); expect(found.projects[0].name).toBe(`${prefix}-00`);
    expect((await load({ q: "no-such-project", page: "999" })).page).toBe(1);
  });
});
