export type BreadcrumbItem = { label: string; href?: string };
export type BreadcrumbRegistration = { pathname: string; owner: symbol; items: BreadcrumbItem[] };

export function projectBreadcrumbs(project: { id: string; name: string }, label: string): BreadcrumbItem[] {
  // /projects/[id] does not exist: the project name must always remain plain text.
  return [{ label: "项目", href: "/projects" }, { label: project.name }, { label }];
}

export function taskBreadcrumbs(task: { title: string; project?: { id: string; name: string } | null }): BreadcrumbItem[] {
  // Missing project association: fall back to /projects + task title, never /projects/[id].
  if (!task.project) return [{ label: "项目", href: "/projects" }, { label: task.title }];
  return [...projectBreadcrumbs(task.project, "看板").slice(0, 2), { label: "看板", href: `/projects/${task.project.id}/board` }, { label: task.title }];
}

export function visibleBreadcrumbs(registration: BreadcrumbRegistration | null, pathname: string): BreadcrumbItem[] {
  return pathname !== "/" && registration?.pathname === pathname ? registration.items : [];
}

export function resetBreadcrumbs(registration: BreadcrumbRegistration | null, pathname: string) {
  // Preserve a new page registration if its effect ran before the provider's pathname reset.
  return registration?.pathname === pathname ? registration : null;
}

export function clearBreadcrumbs(registration: BreadcrumbRegistration | null, owner: symbol) {
  return registration?.owner === owner ? null : registration;
}
