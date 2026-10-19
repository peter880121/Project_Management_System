"use client";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
type Job = { id: string; status: string; attempts: number; errorCode: string | null; completedAt: string | null; dueAt: string; suggestionCount: number | null };
type Schedule = { enabled: boolean; intervalMinutes: number; version: number; nextRunAt: string | null };
const statuses: Record<string, string> = { QUEUED: "待执行", RUNNING: "扫描中", SUCCEEDED: "成功", FAILED: "失败", SKIPPED: "已跳过" };
export function RiskSchedulePanel({ projectId }: { projectId: string }) {
  const { capabilities } = useProjectCapabilities();
  const [schedule, setSchedule] = useState<Schedule | null>(null); const [jobs, setJobs] = useState<Job[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/risk-schedule`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "查询失败"); setSchedule(body.data.schedule); setJobs(body.data.jobs);
  }, [projectId]);
  useEffect(() => { void load().catch(() => setMessage("自动扫描计划暂时无法读取")); }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!schedule) return;
    const data = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/risk-schedule`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: data.get("enabled") === "on", intervalMinutes: Number(data.get("interval")), expectedVersion: schedule.version }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "保存失败"); await load(); setMessage("扫描计划已保存；风险仍需人工处置。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  async function refresh(id?: string) {
    setBusy(true); setMessage("");
    try { if (id) { const response = await fetch(`/api/risk-jobs/${id}/retry`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "重试失败"); setMessage("扫描已重新排队。"); } await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "查询失败"); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 space-y-3 rounded border bg-white p-4" aria-label="自动风险扫描"><div className="flex flex-wrap gap-4"><h3 className="font-semibold">自动风险扫描</h3><Link href="/notifications" className="text-teal-800 underline">查看我的风险通知</Link><button disabled={capabilities?.writable === false || busy} onClick={() => void refresh()} className="text-teal-800 underline">刷新自动扫描状态</button></div><p className="text-sm">启用后由风险 worker 定期扫描。项目暂停、完成或授权失效时不会生成新风险。未运行 worker 时计划保留，提醒通过站内通知展示。</p>
    {schedule && <form key={schedule.version} onSubmit={(event) => void save(event)} className="flex flex-wrap items-center gap-3"><label><input name="enabled" type="checkbox" defaultChecked={schedule.enabled} disabled={capabilities?.writable === false || busy} className="mr-2" />启用自动风险扫描</label><label>扫描间隔<select name="interval" aria-label="扫描间隔" defaultValue={schedule.intervalMinutes} disabled={capabilities?.writable === false || busy} className="ml-2 rounded border p-2">{[15, 30, 60, 360, 1440].map((value) => <option key={value} value={value}>{value} 分钟</option>)}</select></label><button disabled={capabilities?.writable === false || busy} className="rounded border px-3 py-2">保存扫描计划</button><span className="text-sm">{schedule.enabled && schedule.nextRunAt ? `下次计划：${new Date(schedule.nextRunAt).toLocaleString()}` : "当前未启用"}</span></form>}
    {jobs.map((job) => <div key={job.id} className="rounded border p-2 text-sm">{statuses[job.status]} · 尝试 {job.attempts} 次 · {new Date(job.dueAt).toLocaleString()}{job.suggestionCount !== null && ` · 新风险 ${job.suggestionCount} 项`}{job.errorCode && ` · ${job.errorCode}`}{job.status === "FAILED" && <button disabled={capabilities?.writable === false || busy} onClick={() => void refresh(job.id)} className="ml-3 text-teal-800 underline">重试扫描</button>}</div>)}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
