"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectTaskRefresh } from "@/components/projects/task-refresh";
import { taskPhase } from "@/modules/projects/task-phases";
import type { PlanningTask } from "@/modules/planning/gantt-adapter";
import type { MemberLoad } from "@/modules/planning/rules";

export type PlanningSnapshot = { tasks: PlanningTask[]; loads: (MemberLoad & { projectCount: number; taskCount: number; incompleteTaskCount: number })[]; members: { id: string; name: string; status: string }[] };
export function usePlanningSnapshot(projectId: string, week: string, phases = false) {
  const [data, setData] = useState<PlanningSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const current = new AbortController(); request.current = current;
    setLoading(true); setError(""); setMetadataError("");
    // Batch metadata alongside the snapshot; metadata never gates the timeline.
    const metadata = phases ? fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(5000)]) })
      .then(async response => { if (!response.ok) throw new Error(); const body = await response.json() as { data: { id: string; description: string | null }[] }; return new Map(body.data.map(task => [task.id, taskPhase(task.description)])); }).catch(() => null) : null;
    try {
      const response = await fetch(`/api/projects/${projectId}/planning?weekStart=${week}`, { cache: "no-store", signal: current.signal });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "数据读取失败");
      if (current.signal.aborted) return;
      setData(body.data);
      if (metadata) void metadata.then(map => { if (current.signal.aborted) return; if (!map) { setMetadataError("阶段信息暂时无法读取，任务按未分组展示；计划日期仍可查看。"); return; } setData(previous => previous && ({ ...previous, tasks: previous.tasks.map(task => ({ ...task, phase: map.get(task.id) ?? null })) })); });
    } catch (cause) {
      if (!current.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "数据读取失败，请重试"); throw cause; }
    } finally { if (!current.signal.aborted) setLoading(false); }
  }, [projectId, week, phases]);
  useEffect(() => { setData(null); void load().catch(() => {}); return () => request.current?.abort(); }, [load]);
  useProjectTaskRefresh(projectId, load);
  return { data, error, metadataError, loading, load };
}
