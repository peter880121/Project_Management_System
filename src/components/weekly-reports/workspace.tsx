"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCheck,
  Download,
  Plus,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { useToast } from "@/components/toast-provider";
import type { SnapshotSection } from "@/modules/weekly-reports/policy";
import { WeeklySummary } from "./summary";
import { WeeklyRoster } from "./roster";
import { useSearchParams } from "next/navigation";

type Revision = {
  id: string;
  version: number;
  submittedAt: string;
  sections: SnapshotSection[];
  sha256?: string;
  reviews: {
    sectionId: string;
    sectionSha256: string;
    decision: string;
    reason: string;
  }[];
};
type Report = {
  id: string;
  authorName: string;
  authorId: string;
  weekStart: string;
  state: string;
  rowVersion: number;
  sections: SnapshotSection[];
  revisions: Revision[];
  own: boolean;
  editable: boolean;
  canReview: boolean;
};
type List = {
  rows: {
    id: string;
    weekStart: string;
    state: string;
    author?: { name: string; role: string };
  }[];
  total: number;
  projects: { id: string; name: string }[];
  canManage: boolean;
  globalManage: boolean;
  deadline: string;
};
type Candidate = {
  projectId: string;
  sourceType: SnapshotSection["items"][number]["sourceType"];
  sourceId: string;
  text: string;
  kind: SnapshotSection["items"][number]["kind"];
};
const today = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const localWeek = (date: string) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

const labels: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  RETURNED: "待补充",
  COMPLETED: "本周完成",
  ONGOING: "进行中",
  RISK: "问题与协助",
  NEXT_WEEK: "下周计划",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/weekly-reports${path}`, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "操作失败");
  return data;
}
export function WeeklyWorkspace() {
  const { notify } = useToast();
  const searchParams = useSearchParams();
  const authorId = searchParams.get("authorId") ?? undefined;
  const [mode, setMode] = useState(authorId ? "ledger" : "mine");
  const [statsRevision, setStatsRevision] = useState(0);
  const [week, setWeek] = useState(today);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<List>();
  const [report, setReport] = useState<Report>();
  const [sections, setSections] = useState<SnapshotSection[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; text: string }>();
  const active = useRef<AbortController | null>(null);
  const editEpoch = useRef(0);
  const requestEpoch = useRef(0);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api<List>(
        `?mode=${mode}&week=${week}&page=${page}${authorId && mode !== "mine" ? `&authorId=${encodeURIComponent(authorId)}` : ""}`,
        "GET",
        undefined,
        signal,
      );
      setList(result);
    },
    [mode, week, page, authorId],
  );
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    reload(abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [reload]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  function accept(data: Report) {
    setReport(data);
    setSections(data.sections);
    setDirty(false);
    setHistory(null);
    setCandidates([]);
  }
  async function open(id: string) {
    if (dirty && !window.confirm("当前有未保存内容，是否放弃并切换？")) return;
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    const epoch = ++requestEpoch.current;
    try {
      const data = await api<Report>(`/${id}`, "GET", undefined, abort.signal);
      if (epoch === requestEpoch.current) accept(data);
    } catch (e) {
      if (!abort.signal.aborted) notify((e as Error).message, "error");
    }
  }
  function edit(next: SnapshotSection[]) {
    setSections(next);
    setDirty(true);
    editEpoch.current++;
    setError("");
  }
  const save = useCallback(async () => {
    if (!report || !dirty || busy) return report;
    const epoch = editEpoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<Report>(`/${report.id}`, "PATCH", {
        expectedVersion: report.rowVersion,
        sections: sections.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          summary: s.summary,
          items: s.items,
        })),
      });
      setReport(result);
      if (epoch === editEpoch.current) {
        setSections(result.sections);
        setDirty(false);
      }
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [report, dirty, busy, sections]);
  useEffect(() => {
    if (!dirty || busy || error || !sections.length) return;
    const timer = setTimeout(() => {
      void save().catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, busy, error, sections.length, save]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function addSection(projectId: string | null) {
    if (sections.some((s) => s.projectId === projectId)) return;
    edit([
      ...sections,
      {
        id: crypto.randomUUID(),
        projectId,
        projectName:
          list?.projects.find((p) => p.id === projectId)?.name ?? "非项目工作",
        summary: "",
        items: [],
      },
    ]);
  }
  const displayed =
    history === null
      ? sections
      : (report?.revisions.find((r) => r.version === history)?.sections ?? []);
  const editable = Boolean(report?.editable && history === null);
  function reviewsFor(section: SnapshotSection) {
    // The server snapshot has stable ordering; a previous READ remains applicable
    // when this section has not changed during another project's revision.
    const stable = (value: unknown): string =>
      value && typeof value === "object"
        ? Array.isArray(value)
          ? `[${value.map(stable).join(",")}]`
          : `{${Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b, "en"))
              .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
              .join(",")}}`
        : JSON.stringify(value);
    const evidence = stable(section);
    return (
      report?.revisions.flatMap((r) =>
        r.sections.some((s) => s.id === section.id && stable(s) === evidence)
          ? r.reviews.filter((v) => v.sectionId === section.id)
          : [],
      ) ?? []
    );
  }
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-teal-700">
              Work journal · Evidence first
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">个人周报</h1>
            <p className="mt-2 text-sm text-slate-500">
              记录交付进展、问题与下一步。系统汇总事实，由你确认后提交。
            </p>
          </div>
          <CalendarDays className="size-10 text-teal-700" />
        </header>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4">
          <label>
            周内日期{" "}
            <input
              aria-label="周内日期"
              type="date"
              value={week}
              onChange={(e) => {
                setWeek(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="text-xs text-slate-500">
            香港时间周一至周日 · 截止{" "}
            {list?.deadline
              ? new Date(list.deadline).toLocaleString("zh-CN", {
                  timeZone: "Asia/Hong_Kong",
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "加载中"}
          </span>
          <div className="ml-auto flex gap-2">
            {["mine", ...(list?.canManage ? ["inbox", "ledger"] : [])].map(
              (value) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setPage(1);
                  }}
                >
                  {value === "mine"
                    ? "我的周报"
                    : value === "inbox"
                      ? "待我阅知"
                      : "周报台账"}
                </button>
              ),
            )}
          </div>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (dirty) throw new Error("请先保存当前草稿");
                const row = await api<{ id: string }>("", "POST", { week });
                await open(row.id);
                await reload();
              })
            }
          >
            <Plus className="size-4" />
            写周报
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
          >
            {error}
            <button
              className="ml-4"
              onClick={() => {
                setError("");
                void reload();
              }}
            >
              重试列表
            </button>
          </div>
        )}
        {mode !== "mine" && list?.canManage && (
          <WeeklySummary
            week={week}
            authorId={authorId}
            revision={(report?.rowVersion ?? 0) + statsRevision}
          />
        )}
        {mode === "ledger" && list?.globalManage && (
          <WeeklyRoster
            week={week}
            onChange={() => setStatsRevision((v) => v + 1)}
          />
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="font-semibold">
              {mode === "mine" ? "我的记录" : "提交记录"}{" "}
              <span className="text-slate-400">{list?.total ?? "—"}</span>
            </h2>
            {list?.rows.map((row) => (
              <button
                disabled={busy}
                key={row.id}
                className={`w-full justify-start rounded-lg p-3 text-left ${report?.id === row.id ? "border-teal-300 bg-teal-50" : "bg-white"}`}
                onClick={() => open(row.id)}
              >
                <span className="block font-medium">
                  {row.author?.name ?? "本人"}
                </span>
                <span className="text-xs text-slate-500">
                  {localWeek(
                    new Date(new Date(row.weekStart).getTime() + 8 * 3600000)
                      .toISOString()
                      .slice(0, 10),
                  )}{" "}
                  · {labels[row.state]}
                </span>
              </button>
            ))}
            {list && !list.rows.length && (
              <p className="py-8 text-center text-sm text-slate-500">
                本周暂无记录，先写下一个交付进展。
              </p>
            )}
            <div className="flex justify-between">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <button
                disabled={!list || page * 20 >= list.total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </aside>
          <section className="min-w-0 space-y-4">
            {!report ? (
              <div className="rounded-2xl border border-dashed bg-white p-16 text-center text-slate-500">
                选择一份周报，或点击「写周报」开始。
              </div>
            ) : (
              <>
                <div className="rounded-xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">
                        {report.authorName}的周报
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {localWeek(
                          new Date(
                            new Date(report.weekStart).getTime() + 8 * 3600000,
                          )
                            .toISOString()
                            .slice(0, 10),
                        )}{" "}
                        当周 · {labels[report.state]} · 版本 {report.rowVersion}{" "}
                        · {dirty ? "未保存" : "已保存"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {editable && (
                        <>
                          <button
                            disabled={busy || !dirty}
                            onClick={() =>
                              void save().catch((e) =>
                                notify(e.message, "error"),
                              )
                            }
                          >
                            <Save className="size-4" />
                            保存
                          </button>
                          <button
                            disabled={busy || dirty}
                            onClick={() =>
                              run(async () => {
                                const result = await api<{
                                  candidates: Candidate[];
                                  truncated: boolean;
                                }>(`/${report.id}/collect`, "POST");
                                setCandidates(result.candidates);
                                if (result.truncated)
                                  notify(
                                    "候选记录较多，本次最多汇总每类 200 条，请补充其余工作",
                                    "error",
                                  );
                              })
                            }
                          >
                            <RefreshCw className="size-4" />
                            汇总我的工作
                          </button>
                          <button
                            disabled={busy || dirty}
                            onClick={() =>
                              run(async () => {
                                accept(
                                  await api<Report>(
                                    `/${report.id}/submit`,
                                    "POST",
                                    { expectedVersion: report.rowVersion },
                                  ),
                                );
                                await reload();
                                notify("周报已提交，证据快照已保存");
                              })
                            }
                          >
                            <Send className="size-4" />
                            确认提交
                          </button>
                        </>
                      )}
                      {report.own && report.state === "SUBMITTED" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            setFeedback({ id: "revise", text: "" })
                          }
                        >
                          发起修订
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const data = await api<Report>(
                              `/${report.id}/export`,
                              "POST",
                            );
                            const url = URL.createObjectURL(
                              new Blob([JSON.stringify(data, null, 2)], {
                                type: "application/json",
                              }),
                            );
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = `weekly-report-${report.id}.json`;
                            link.click();
                            URL.revokeObjectURL(url);
                            notify("周报已导出并记录审计");
                          })
                        }
                      >
                        <Download className="size-4" />
                        导出
                      </button>
                    </div>
                  </div>
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                    申报工时由本人填写，不等同于任务累计实际工时。提交后保留不可改写的版本；项目负责人仅可阅知自己项目的分区。
                  </p>
                  {report.revisions.length > 0 && (
                    <label className="mt-3 block text-sm">
                      查看版本{" "}
                      <select
                        value={history ?? "current"}
                        onChange={(e) =>
                          setHistory(
                            e.target.value === "current"
                              ? null
                              : Number(e.target.value),
                          )
                        }
                      >
                        <option value="current">当前内容</option>
                        {report.revisions.map((r) => (
                          <option key={r.id} value={r.version}>
                            提交 V{r.version} ·{" "}
                            {new Date(r.submittedAt).toLocaleString("zh-CN", {
                              timeZone: "Asia/Hong_Kong",
                            })}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {feedback?.id === "revise" && (
                  <form
                    className="rounded-xl border bg-white p-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        accept(
                          await api<Report>(`/${report.id}/revise`, "POST", {
                            expectedVersion: report.rowVersion,
                            reason: feedback.text,
                          }),
                        );
                        setFeedback(undefined);
                        notify("已开启新修订，原提交快照保留");
                      });
                    }}
                  >
                    <label>
                      修订说明
                      <textarea
                        autoFocus
                        required
                        minLength={5}
                        maxLength={1000}
                        className="mt-2 w-full"
                        value={feedback.text}
                        onChange={(e) =>
                          setFeedback({ ...feedback, text: e.target.value })
                        }
                      />
                    </label>
                    <button disabled={busy}>确认修订</button>
                    <button
                      type="button"
                      onClick={() => setFeedback(undefined)}
                    >
                      取消
                    </button>
                  </form>
                )}
                {candidates.length > 0 && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
                    <h3 className="font-semibold">
                      候选工作 · 点击采纳，不会自动提交
                    </h3>
                    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                      {candidates.map((c) => (
                        <div
                          className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm"
                          key={`${c.sourceType}:${c.sourceId}`}
                        >
                          <span>{c.text}</span>
                          <button
                            disabled={busy}
                            onClick={() => {
                              let next = [...sections];
                              let index = next.findIndex(
                                (s) => s.projectId === c.projectId,
                              );
                              if (index < 0) {
                                next.push({
                                  id: crypto.randomUUID(),
                                  projectId: c.projectId,
                                  projectName:
                                    list?.projects.find(
                                      (p) => p.id === c.projectId,
                                    )?.name ?? "项目",
                                  summary: "",
                                  items: [],
                                });
                                index = next.length - 1;
                              }
                              next = next.map((s, i) =>
                                i === index
                                  ? {
                                      ...s,
                                      items: [
                                        ...s.items,
                                        {
                                          kind: c.kind,
                                          text: c.text,
                                          sourceType: c.sourceType,
                                          sourceId: c.sourceId,
                                          targetDate: null,
                                          declaredHours: null,
                                        },
                                      ],
                                    }
                                  : s,
                              );
                              edit(next);
                              setCandidates((rows) =>
                                rows.filter(
                                  (r) =>
                                    r.sourceId !== c.sourceId ||
                                    r.sourceType !== c.sourceType,
                                ),
                              );
                            }}
                          >
                            采纳
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {displayed.map((section, si) => (
                  <article
                    key={section.id}
                    className="rounded-xl border bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">
                        {section.projectName}
                      </h3>
                      {reviewsFor(section).map((r, i) => (
                        <span
                          key={i}
                          className={`rounded-full px-3 py-1 text-xs ${r.decision === "READ" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-900"}`}
                        >
                          {r.decision === "READ"
                            ? "已阅"
                            : `需补充：${r.reason}`}
                        </span>
                      ))}
                      {editable && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            edit(sections.filter((s) => s.id !== section.id))
                          }
                        >
                          移除分区
                        </button>
                      )}
                    </div>
                    <label className="mt-4 block text-sm">
                      项目进展摘要
                      <textarea
                        aria-label={`${section.projectName}进展摘要`}
                        className="mt-2 min-h-24 w-full"
                        disabled={!editable || busy}
                        maxLength={5000}
                        value={section.summary}
                        onChange={(e) =>
                          edit(
                            sections.map((s, i) =>
                              i === si ? { ...s, summary: e.target.value } : s,
                            ),
                          )
                        }
                      />
                    </label>
                    <div className="mt-4 space-y-3">
                      {section.items.map((item, ii) => (
                        <div
                          key={ii}
                          className="rounded-lg border bg-slate-50 p-3"
                        >
                          <div className="flex flex-wrap gap-3">
                            <select
                              aria-label="工作类型"
                              disabled={!editable || busy}
                              value={item.kind}
                              onChange={(e) =>
                                edit(
                                  sections.map((s, i) =>
                                    i === si
                                      ? {
                                          ...s,
                                          items: s.items.map((v, j) =>
                                            j === ii
                                              ? {
                                                  ...v,
                                                  kind: e.target
                                                    .value as typeof item.kind,
                                                }
                                              : v,
                                          ),
                                        }
                                      : s,
                                  ),
                                )
                              }
                            >
                              {[
                                "COMPLETED",
                                "ONGOING",
                                "RISK",
                                "NEXT_WEEK",
                              ].map((kind) => (
                                <option key={kind} value={kind}>
                                  {labels[kind]}
                                </option>
                              ))}
                            </select>
                            {item.sourceId && (
                              <span className="text-xs text-slate-500">
                                已关联业务来源 · {item.sourceType}
                              </span>
                            )}
                            {editable && (
                              <button
                                className="ml-auto"
                                disabled={busy}
                                onClick={() =>
                                  edit(
                                    sections.map((s, i) =>
                                      i === si
                                        ? {
                                            ...s,
                                            items: s.items.filter(
                                              (_, j) => j !== ii,
                                            ),
                                          }
                                        : s,
                                    ),
                                  )
                                }
                              >
                                移除
                              </button>
                            )}
                          </div>
                          <textarea
                            aria-label="工作内容"
                            className="mt-3 min-h-20 w-full"
                            disabled={!editable || busy}
                            value={item.text}
                            maxLength={2000}
                            placeholder="描述进展；问题请说明影响、需要谁协助和解决期限"
                            onChange={(e) =>
                              edit(
                                sections.map((s, i) =>
                                  i === si
                                    ? {
                                        ...s,
                                        items: s.items.map((v, j) =>
                                          j === ii
                                            ? { ...v, text: e.target.value }
                                            : v,
                                        ),
                                      }
                                    : s,
                                ),
                              )
                            }
                          />
                          <div className="mt-2 flex flex-wrap gap-4 text-sm">
                            <label>
                              目标日期{" "}
                              <input
                                type="date"
                                disabled={!editable || busy}
                                value={item.targetDate ?? ""}
                                onChange={(e) =>
                                  edit(
                                    sections.map((s, i) =>
                                      i === si
                                        ? {
                                            ...s,
                                            items: s.items.map((v, j) =>
                                              j === ii
                                                ? {
                                                    ...v,
                                                    targetDate:
                                                      e.target.value || null,
                                                  }
                                                : v,
                                            ),
                                          }
                                        : s,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              申报工时{" "}
                              <input
                                aria-label="申报工时"
                                type="number"
                                min="0"
                                max="168"
                                step="0.25"
                                className="w-24"
                                disabled={!editable || busy}
                                value={item.declaredHours ?? ""}
                                onChange={(e) =>
                                  edit(
                                    sections.map((s, i) =>
                                      i === si
                                        ? {
                                            ...s,
                                            items: s.items.map((v, j) =>
                                              j === ii
                                                ? {
                                                    ...v,
                                                    declaredHours:
                                                      e.target.value === ""
                                                        ? null
                                                        : Number(
                                                            e.target.value,
                                                          ),
                                                  }
                                                : v,
                                            ),
                                          }
                                        : s,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                    {editable && (
                      <button
                        className="mt-4"
                        disabled={busy}
                        onClick={() =>
                          edit(
                            sections.map((s, i) =>
                              i === si
                                ? {
                                    ...s,
                                    items: [
                                      ...s.items,
                                      {
                                        kind: "COMPLETED",
                                        text: "",
                                        sourceType: null,
                                        sourceId: null,
                                        targetDate: null,
                                        declaredHours: null,
                                      },
                                    ],
                                  }
                                : s,
                            ),
                          )
                        }
                      >
                        <Plus className="size-4" />
                        添加工作项
                      </button>
                    )}
                    {report.canReview &&
                      report.state === "SUBMITTED" &&
                      history === null && (
                        <div className="mt-4 flex flex-wrap gap-3 border-t pt-4">
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                accept(
                                  await api<Report>(
                                    `/${report.id}/review`,
                                    "POST",
                                    {
                                      expectedVersion: report.rowVersion,
                                      sectionId: section.id,
                                      decision: "READ",
                                      reason: "已阅知",
                                    },
                                  ),
                                );
                                notify("已阅知该项目分区");
                              })
                            }
                          >
                            <CheckCheck className="size-4" />
                            已阅
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              setFeedback({ id: section.id, text: "" })
                            }
                          >
                            要求补充
                          </button>
                        </div>
                      )}
                    {feedback?.id === section.id && (
                      <form
                        className="mt-4 rounded-lg bg-amber-50 p-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            accept(
                              await api<Report>(
                                `/${report.id}/review`,
                                "POST",
                                {
                                  expectedVersion: report.rowVersion,
                                  sectionId: section.id,
                                  decision: "RETURNED",
                                  reason: feedback.text,
                                },
                              ),
                            );
                            setFeedback(undefined);
                            await reload();
                            notify("已退回并保留原提交版本");
                          });
                        }}
                      >
                        <label>
                          补充说明（至少 5 个字）
                          <textarea
                            autoFocus
                            required
                            minLength={5}
                            maxLength={1000}
                            className="mt-2 w-full"
                            value={feedback.text}
                            onChange={(e) =>
                              setFeedback({ ...feedback, text: e.target.value })
                            }
                          />
                        </label>
                        <button disabled={busy}>确认退回</button>
                        <button
                          type="button"
                          onClick={() => setFeedback(undefined)}
                        >
                          取消
                        </button>
                      </form>
                    )}
                  </article>
                ))}
                {editable && (
                  <div className="flex gap-3 rounded-xl border border-dashed p-4">
                    <select
                      aria-label="添加项目分区"
                      value=""
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.value)
                          addSection(
                            e.target.value === "personal"
                              ? null
                              : e.target.value,
                          );
                      }}
                    >
                      <option value="">＋ 添加项目分区</option>
                      {list?.projects
                        .filter(
                          (p) => !sections.some((s) => s.projectId === p.id),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      {!sections.some((s) => s.projectId === null) && (
                        <option value="personal">
                          非项目工作（仅本人及全局管理可见）
                        </option>
                      )}
                    </select>
                    <span className="text-xs text-slate-500">
                      暂停、归档项目可记录历史工作，不能从周报修改项目资产。
                    </span>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <p className="text-xs text-slate-400">
          当前日期 {today()} · 所有工时均为本人申报；阅知不代表验收或认证。
        </p>
      </div>
    </main>
  );
}
