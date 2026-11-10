import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { APPEND_ONLY_PROJECT_TABLES, FROZEN_PROJECT_TABLES, SPECIAL_FREEZE_TABLES, READ_SESSION_PROJECT_TABLES, AUDIT_OPERATIONAL_TABLES } from "./freeze-manifest";
it("requires a freeze policy when a new project-scoped Prisma model is introduced", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const classified = new Set<string>([...APPEND_ONLY_PROJECT_TABLES, ...FROZEN_PROJECT_TABLES, ...SPECIAL_FREEZE_TABLES, ...READ_SESSION_PROJECT_TABLES, ...AUDIT_OPERATIONAL_TABLES]);
  for (const match of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) if (/\bprojectId\s+String\??/.test(match[2])) expect(classified.has(match[1]), `${match[1]} needs a database freeze policy`).toBe(true);
});
