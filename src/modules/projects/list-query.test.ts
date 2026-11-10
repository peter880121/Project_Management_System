import { describe, expect, it } from "vitest";
import { parseProjectListQuery, projectListWhere, projectListUrl, projectListReturnTo, projectListOrder } from "./list-query";
describe("project list query boundaries", () => {
  it("defaults to current projects and supports legacy status links", () => {
    expect(parseProjectListQuery({})).toMatchObject({ view: "current", status: null, q: "", page: 1, sort: "created_desc" });
    expect(parseProjectListQuery({ status: "ALL" }).view).toBe("all"); expect(parseProjectListQuery({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
  });
  it.each(["-1", "Infinity", "1.5", "100001", "abc"])("normalizes invalid page %s", page => expect(parseProjectListQuery({ page }).page).toBe(1));
  it("bounds search inputs, tolerates repeated fields and ignores invalid creation IDs", () => {
    expect(parseProjectListQuery({ status: "unknown", sort: "injection", q: "字".repeat(200), created: "bad", page: ["2", "3"] })).toMatchObject({ status: null, sort: "created_desc", q: "字".repeat(100), created: undefined, page: 2 });
  });
  it("intersects visibility with search and status rather than replacing its OR", () => {
    const visible = { OR: [{ ownerId: "me" }, { members: { some: { userId: "me", active: true } } }] };
    const where = projectListWhere(visible, parseProjectListQuery({ q: "%_\\" }));
    expect(where.AND).toEqual([visible, { OR: [{ name: { contains: "\\%\\_\\\\" } }, { description: { contains: "\\%\\_\\\\" } }] }, { status: { in: ["PLANNING", "ACTIVE"] } }]);
  });
  it("preserves filters in URLs while allowing pagination reset and stable ordering", () => {
    const query = parseProjectListQuery({ q: "医院 & EMR", status: "ARCHIVED", page: "3", sort: "name_asc" });
    const url = new URL(projectListUrl(query, { page: 1 }), "https://example.org"); expect(url.searchParams.get("q")).toBe(query.q); expect(url.searchParams.get("status")).toBe("ARCHIVED"); expect(url.searchParams.has("page")).toBe(false);
    expect(projectListOrder(query)).toEqual([{ name: "asc" }, { id: "asc" }]); expect(projectListOrder(parseProjectListQuery({}))).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
  it("never accepts arbitrary return destinations", () => {
    for (const raw of ["https://evil.example", "//evil.example", "/projects/../users?x=1", "/projects?%zz", ["/projects?view=all"]]) expect(projectListReturnTo(raw)).toMatch(/^\/projects(?:\?view=current)?$/);
    expect(projectListReturnTo("/projects?q=医院&view=all&page=2")).toBe("/projects?view=all&q=%E5%8C%BB%E9%99%A2&page=2");
  });
});
