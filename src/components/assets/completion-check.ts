import type { TaskDetail } from "@/components/tasks/board-types";
export async function checkCompletionTask(taskId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store", signal });
  const body = await response.json() as { data?: TaskDetail; error?: string };
  if (!response.ok || !body.data || body.data.id !== taskId) throw new Error(body.error || "无法核对交付证据，请刷新后重试");
  return body.data;
}
