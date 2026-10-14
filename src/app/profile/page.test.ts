import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getSession, getProfile, redirectMock } = vi.hoisted(() => ({ getSession: vi.fn(), getProfile: vi.fn(), redirectMock: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentSession: getSession }));
vi.mock("@/modules/auth/profile", () => ({ getProfileForUser: getProfile }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./account-actions", () => ({ AccountActions: () => createElement("div", null, "account actions") }));
import ProfilePage from "./page";

const profile = { id: "verified-user", name: "Synthetic Member", email: "synthetic@medpm.local", role: "MEMBER", status: "ACTIVE", lastLoginAt: new Date("2026-10-14T00:00:00Z") };
describe("profile server page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ userId: profile.id, sessionId: "session-id" });
    getProfile.mockResolvedValue(profile);
    redirectMock.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });
  it("uses the verified session identity to read and render safe profile fields", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(getProfile).toHaveBeenCalledWith(profile.id);
    expect(html).toContain(profile.email);
    expect(html).toContain("2026-10-14 00:00:00.000 UTC");
    expect(html).toContain('aria-label="主导航"');
    expect(html).not.toContain("session-id");
  });
  it("redirects without querying profile when unauthenticated", async () => {
    getSession.mockResolvedValue(null);
    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=/profile");
    expect(getProfile).not.toHaveBeenCalled();
  });
  it.each([null, { ...profile, status: "DISABLED" }, { ...profile, status: "PENDING" }])("rejects unavailable account %j", async (user) => {
    getProfile.mockResolvedValue(user);
    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=/profile");
  });
  it.each(["session", "profile"])("shows retry rather than redirects for %s query failure", async (query) => {
    (query === "session" ? getSession : getProfile).mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toContain("暂时无法加载，请重试");
    expect(html).not.toContain(profile.email);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
