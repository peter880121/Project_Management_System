const DAY = 86400000;
export function utcWeekStart(date = new Date()) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); return day;
}
export function dateDay(date: Date) { return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
export function wouldCreateCycle(taskId: string, prerequisiteIds: string[], edges: { taskId: string; dependsOnTaskId: string }[]) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.taskId === taskId) continue;
    graph.set(edge.taskId, [...(graph.get(edge.taskId) ?? []), edge.dependsOnTaskId]);
  }
  graph.set(taskId, prerequisiteIds);
  const pending = [...prerequisiteIds]; const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!; if (id === taskId) return true;
    if (visited.has(id)) continue; visited.add(id); pending.push(...(graph.get(id) ?? []));
  }
  return false;
}
export type LoadTask = { id: string; title: string; projectId: string; assigneeId: string | null; status: string; plannedStartDate: Date | null; dueDate: Date | null; estimateHours: number | null };
export type MemberLoad = { userId: string; name: string; capacityHours: number | null; capacityVersion: number; plannedHours: number; overloaded: boolean | null; taskIds: string[]; projectIds: string[]; incompleteTaskIds: string[] };
/** Weekly budget uses calendar days, not an assumed work calendar or remaining-work estimate. */
export function calculateWeeklyLoad(tasks: LoadTask[], members: { id: string; name: string }[], capacities: { userId: string; hours: number | null; version: number }[], weekStart: Date): MemberLoad[] {
  const start = dateDay(weekStart); const end = start + 6 * DAY;
  return members.map((member) => {
    const capacity = capacities.find((row) => row.userId === member.id); let hours = 0;
    const taskIds: string[] = []; const projectIds = new Set<string>(); const incompleteTaskIds: string[] = [];
    for (const task of tasks) {
      if (task.assigneeId !== member.id || task.status === "DONE") continue;
      if (task.plannedStartDate && dateDay(task.plannedStartDate) > end) continue;
      // Unfinished overdue work has no trustworthy current allocation until rescheduled.
      if (task.dueDate && dateDay(task.dueDate) < start) { incompleteTaskIds.push(task.id); continue; }
      if (!task.plannedStartDate || !task.dueDate || task.estimateHours === null || dateDay(task.plannedStartDate) > dateDay(task.dueDate)) { incompleteTaskIds.push(task.id); continue; }
      const first = dateDay(task.plannedStartDate); const last = dateDay(task.dueDate);
      const overlap = Math.max(0, Math.min(end, last) - Math.max(start, first) + DAY) / DAY;
      if (!overlap) continue;
      hours += task.estimateHours * overlap / ((last - first) / DAY + 1); taskIds.push(task.id); projectIds.add(task.projectId);
    }
    const capacityHours = capacity?.hours ?? null;
    return { userId: member.id, name: member.name, capacityHours, capacityVersion: capacity?.version ?? 0, plannedHours: Math.round(hours * 100) / 100,
      overloaded: capacityHours === null || (incompleteTaskIds.length > 0 && hours <= capacityHours + 0.000001) ? null : hours > capacityHours + 0.000001, taskIds, projectIds: [...projectIds], incompleteTaskIds };
  });
}
