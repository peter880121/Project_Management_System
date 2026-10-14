import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { getUser, listUsers, redirectMock } = vi.hoisted(() => ({ getUser: vi.fn(), listUsers: vi.fn(), redirectMock: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("@/modules/users/repositories", () => ({ listManagedUsers: listUsers }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./users-manager", () => ({ UsersManager: ({ actorId }: { actorId: string }) => createElement("div", null, `manager:${actorId}`) }));
import UsersPage from "./page";

describe("users server page", () => {
  beforeEach(() => {
    vi.clearAllMocks(); getUser.mockResolvedValue({ id: "verified-admin", role: "ADMIN" });
    listUsers.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    redirectMock.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });
  it("redirects guests without listing users", async () => {
    getUser.mockResolvedValue(null);
    await expect(UsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=/users"); expect(listUsers).not.toHaveBeenCalled();
  });
  it.each(["PM", "MEMBER", "QA"])("denies %s without listing users", async (role) => {
    getUser.mockResolvedValue({ id: "non-admin", role });
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("无权访问用户管理"); expect(listUsers).not.toHaveBeenCalled();
  });
  it("renders ADMIN management and filters using the shared query service", async () => {
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({ role: "QA" }) }));
    expect(html).toContain("manager:verified-admin");
    expect(listUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20, role: "QA" });
  });
  it.each(["identity", "list"])("shows retry on %s failure without an authentication redirect", async (part) => {
    (part === "identity" ? getUser : listUsers).mockRejectedValue(new Error("database down"));
    expect(renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }))).toContain("暂时无法加载，请重试");
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("rejects invalid search params before querying", async () => {
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({ pageSize: "101" }) }));
    expect(html).toContain("筛选或分页参数无效"); expect(listUsers).not.toHaveBeenCalled();
  });
  it("returns to a valid page if filtering or changes emptied the last page", async () => {
    listUsers.mockResolvedValue({ data: [], total: 1, page: 3, pageSize: 20 });
    await expect(UsersPage({ searchParams: Promise.resolve({ page: "3", keyword: "synthetic" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/users?page=1&pageSize=20&keyword=synthetic");
  });
});
