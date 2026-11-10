import type { Role } from "@prisma/client";

export type LayoutUser = { id: string; role: Role; name: string; email: string };
export function sidebarItems(role: Role) {
  return [
    { href: "/", label: "智能助手", icon: "home" },
    { href: "/weekly-reports", label: "个人周报", icon: "audit" },
    ...(["ADMIN", "PMO", "PM"].includes(role) ? [{ href: "/dashboard", label: "数据决策中心", icon: "dashboard" }] : []),
    ...(role !== "PMO" ? [{ href: "/projects", label: "项目", icon: "projects" }] : []),
    ...(["ADMIN", "QA"].includes(role) ? [{ href: "/audit", label: "审计", icon: "audit" }] : []),
    ...(["PM", "MEMBER"].includes(role) ? [{ href: "/audit/issues", label: "整改跟踪", icon: "audit" }] : []),
    ...(role === "ADMIN" ? [{ href: "/users", label: "用户管理", icon: "users" }] : []),
    { href: "/profile", label: "个人资料", icon: "profile" },
  ];
}
export function isActiveNavigation(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/projects" && pathname.startsWith("/tasks/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
export function isProtectedPage(pathname: string) {
  return ["/weekly-reports", "/dashboard", "/projects", "/tasks", "/audit", "/users", "/profile", "/notifications"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
