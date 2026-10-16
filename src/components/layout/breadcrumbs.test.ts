import { describe, expect, it } from "vitest";
import { clearBreadcrumbs, projectBreadcrumbs, resetBreadcrumbs, taskBreadcrumbs, visibleBreadcrumbs } from "./breadcrumbs";

describe("server supplied breadcrumbs", () => {
  const project = { id: "project-id", name: "Atlas Release Readiness" };
  it("keeps the project name and current board as plain text", () => {
    expect(projectBreadcrumbs(project, "看板")).toEqual([{ label: "项目", href: "/projects" }, { label: project.name }, { label: "看板" }]);
  });
  it("links task ancestors to the project list and existing board", () => {
    expect(taskBreadcrumbs({ project, title: "Verify audit trail" })).toEqual([{ label: "项目", href: "/projects" }, { label: project.name }, { label: "看板", href: "/projects/project-id/board" }, { label: "Verify audit trail" }]);
  });
  it("falls back to the project list for a missing task project", () => {
    expect(taskBreadcrumbs({ project: null, title: "Orphan task" })).toEqual([{ label: "项目", href: "/projects" }, { label: "Orphan task" }]);
  });
  const owner = Symbol("A");
  const registration = { pathname: "/projects/A/board", owner, items: projectBreadcrumbs(project, "看板") };
  it("never displays project A on project B or the home page", () => {
    expect(visibleBreadcrumbs(registration, "/projects/B/board")).toEqual([]);
    expect(visibleBreadcrumbs(registration, "/")).toEqual([]);
    expect(visibleBreadcrumbs(registration, registration.pathname)).toEqual(registration.items);
  });
  it("clears stale paths without erasing a newly registered path", () => {
    expect(resetBreadcrumbs(registration, "/projects/B/board")).toBeNull();
    expect(resetBreadcrumbs(registration, registration.pathname)).toBe(registration);
  });
  it("old unmount cleanup cannot erase the next page registration", () => {
    expect(clearBreadcrumbs(registration, Symbol("previous-page"))).toBe(registration);
    expect(clearBreadcrumbs(registration, owner)).toBeNull();
  });
});
