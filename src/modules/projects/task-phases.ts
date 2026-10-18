import { STANDARD_PROJECT_TASKS } from "./templates";

export const UNGROUPED_PHASE = "未分组";
export const PROJECT_PHASES: string[] = [...new Set(STANDARD_PROJECT_TASKS.map(task => task.phase))];
export function taskPhase(description?: string | null): string | null {
  return description?.match(/^[\t ]*所属阶段[\t ]*[:：][\t ]*([^\r\n]*)/m)?.[1]?.trim() || null;
}
export function groupTasksByPhase<T extends { description?: string | null }>(tasks: T[]) {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const phase = taskPhase(task.description) ?? UNGROUPED_PHASE;
    const group = groups.get(phase);
    if (group) group.push(task);
    else groups.set(phase, [task]);
  }
  const rank = (phase: string) => phase === UNGROUPED_PHASE ? Infinity : PROJECT_PHASES.includes(phase) ? PROJECT_PHASES.indexOf(phase) : PROJECT_PHASES.length;
  return [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([phase, tasks]) => ({ phase, tasks }));
}
export function phaseColorClass(phase?: string | null) {
  const index = PROJECT_PHASES.indexOf(phase ?? "");
  return index < 0 ? "phase-other" : `phase-${index}`;
}
