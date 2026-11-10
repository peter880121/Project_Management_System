"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  ClipboardList,
  Download,
  FolderKanban,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import type { Role } from "@prisma/client";
import type {
  DecisionCell,
  DecisionData,
  DecisionQuery,
  DecisionRow,
} from "@/modules/dashboard/decision-schema";
import { useToast } from "@/components/toast-provider";
import { WeeklySummary } from "@/components/weekly-reports/summary";
import { Dashboard } from "./dashboard";

const today = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const defaultFrom = () =>
  new Date(Date.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
const labels: Record<string, string> = {
  PLANNING: "规划中",
  ACTIVE: "进行中",
  ON_HOLD: "已暂停",
  PENDING_ACCEPTANCE: "待验收",
  ARCHIVED: "已归档",
  CANCELLED: "已取消",
  COMPLETED: "历史已完成",
  TODO: "待办",
  IN_PROGRESS: "进行中",
  BLOCKED: "受阻",
  DONE: "已完成",
  DRAFT: "草稿",
  IN_REVIEW: "审核中",
  APPROVED: "已批准",
  IMPLEMENTING: "实施中",
  VERIFYING: "验证中",
  CUSTOMER_CONFIRMATION: "待客户确认",
  CLOSED: "已关闭",
  CANCEL_REVIEW: "取消待审",
  LEGACY: "历史待治理",
  DISABLED: "已禁用",
  PENDING: "待激活",
};
const tabs = [
  { id: "overview", name: "交付总览", icon: Activity },
  { id: "projects", name: "项目", icon: FolderKanban },
  { id: "tasks", name: "任务", icon: ClipboardList },
  { id: "requirements", name: "需求", icon: ClipboardList },
  { id: "people", name: "人员", icon: UsersRound },
  { id: "weekly", name: "周报", icon: ClipboardList },
];
const columns: Record<string, [string, string][]> = {
  projects: [
    ["title", "项目"],
    ["status", "生命周期"],
    ["ownerName", "项目负责人"],
    ["progress", "任务完成率"],
    ["overdueTasks", "逾期任务"],
    ["blocked", "受阻"],
    ["unscheduled", "待排期"],
    ["openRequirements", "未关闭需求"],
    ["customerPending", "待客户确认"],
    ["pendingChanges", "待审变更"],
    ["missingDeliverables", "交付物缺口"],
    ["signatureGaps", "本轮签名缺口"],
    ["recentRiskNotices", "近7日待处理预警"],
    ["statusSince", "当前状态起点"],
  ],
  tasks: [
    ["title", "任务"],
    ["projectName", "项目"],
    ["projectStatus", "项目状态"],
    ["status", "任务状态"],
    ["assigneeName", "当前负责人"],
    ["phase", "阶段"],
    ["dueDate", "计划完成"],
    ["completedAt", "实际完成"],
    ["estimateHours", "计划工时"],
    ["actualHours", "累计实际工时"],
    ["varianceHours", "工时偏差"],
    ["overdueDays", "逾期天数"],
  ],
  requirements: [
    ["title", "需求"],
    ["number", "需求编号"],
    ["projectName", "项目"],
    ["status", "状态"],
    ["ownerName", "当前负责人"],
    ["priority", "优先级"],
    ["dueDate", "计划完成"],
    ["completedAt", "实际完成"],
    ["linkedTasks", "有效关联任务"],
    ["approvedVersion", "批准版本"],
    ["draftVersion", "草稿版本"],
  ],
  people: [
    ["title", "人员 / 当前角色"],
    ["ownedProjects", "负责项目"],
    ["participatingProjects", "参与项目"],
    ["openTasks", "活跃未完成任务"],
    ["overdueTasks", "活跃逾期任务"],
    ["openRequirements", "活跃未关闭需求"],
    ["openEstimatedHours", "未完成任务预计工时"],
    ["frozenTasks", "冻结项目任务"],
    ["handledEvents", "历史办理事件"],
  ],
};
const personTaskColumns: [string, string][] = [
  ["title", "任务"],
  ["projectName", "项目"],
  ["phase", "阶段"],
  ["status", "任务状态"],
  ["dueDate", "预计完成"],
  ["overdueDays", "逾期天数"],
  ["estimateHours", "预计工时"],
  ["taskAction", "操作"],
];
const handlingLabels: Record<string, string> = {
  TASK_CREATED: "创建任务",
  TASK_SIGNED_AND_COMPLETED: "签署并完成任务",
  TASK_REOPENED: "重新打开任务",
  TASK_CANCELLED: "取消任务",
  REQUIREMENT_CREATED: "创建需求",
  REQUIREMENT_WORKFLOW_CHANGED: "办理需求流程",
  TEST_CASE_CREATED: "创建测试用例",
  TEST_CASE_UPDATED: "更新测试用例",
  DELIVERABLE_CREATED: "创建交付版本",
  DELIVERABLE_REVIEWED: "审批交付物",
  MEETING_CREATED: "创建会议纪要",
  MEETING_FINALIZED: "定稿会议纪要",
  PROJECT_QA_APPROVED: "批准项目验收",
  PROJECT_ARCHIVED: "归档项目",
};
function DecisionStatistics({
  data,
  dimension,
}: {
  data: DecisionData;
  dimension: string;
}) {
  return (
    <div className="space-y-6">
      <section
        aria-label="维度关键指标"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {data.metrics.map((m) => (
          <article
            className="rounded-2xl border border-white bg-white/90 p-5 shadow-sm"
            key={m.label}
          >
            <h2 className="text-sm text-slate-500">{m.label}</h2>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">
              {m.value === null
                ? "—"
                : m.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">{m.detail}</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-5 font-semibold">
          {dimension === "people" ? "当前角色分布" : "当前筛选状态分布"}
        </h2>
        {data.groups.length ? (
          <Distribution groups={data.groups} />
        ) : (
          <p className="text-sm text-slate-500">
            当前范围暂无记录，调整筛选后再查看。
          </p>
        )}
      </section>
    </div>
  );
}
function State({ value }: { value: DecisionCell | undefined }) {
  const text = String(value ?? "未知");
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${["CANCELLED", "BLOCKED"].includes(text) ? "bg-rose-50 text-rose-700" : ["ON_HOLD", "PENDING_ACCEPTANCE", "IN_REVIEW"].includes(text) ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-800"}`}
    >
      {labels[text] ?? text}
    </span>
  );
}
function Distribution({ groups }: { groups: DecisionData["groups"] }) {
  const id = useId();
  const maximum = Math.max(1, ...groups.map((g) => g.count));
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-600">{labels[g.label] ?? g.label}</span>
            <span className="font-semibold tabular-nums text-teal-900">
              {g.count}
            </span>
          </div>
          <svg
            role="img"
            aria-label={`${labels[g.label] ?? g.label} ${g.count}`}
            className="h-3 w-full overflow-hidden rounded-full"
            viewBox="0 0 1000 16"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={`${id}-${g.label}`}>
                <stop className="[stop-color:theme(colors.teal.700)]" />
                <stop
                  offset="100%"
                  className="[stop-color:theme(colors.teal.300)]"
                />
              </linearGradient>
            </defs>
            <rect width={1000} height={16} rx={8} className="fill-slate-100" />
            <rect
              width={Math.min(1, Math.max(0, g.count / maximum)) * 1000}
              height={16}
              rx={8}
              fill={`url(#${id}-${g.label})`}
            >
              <title>
                {labels[g.label] ?? g.label}：{g.count}
              </title>
            </rect>
          </svg>
        </div>
      ))}
    </div>
  );
}
export function DecisionCenter({ role }: { role: Role }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { notify } = useToast();
  const tab = params.get("tab") ?? "overview";
  const dimension = tabs.some((t) => t.id === tab) ? tab : "overview";
  const [responseData, setData] = useState<
    DecisionData & { events: DecisionRow[] }
  >();
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const request = useRef(0);
  const navigationQuery = useRef(params.toString());
  const observedQuery = useRef(params.toString());
  if (observedQuery.current !== params.toString()) {
    observedQuery.current = params.toString();
    navigationQuery.current = params.toString();
  }
  const query = new URLSearchParams(params.toString());
  query.delete("tab");
  query.delete("week");
  query.delete("reportRole");
  query.set("dimension", dimension);
  const encoded = query.toString();
  const data = loadedQuery === encoded ? responseData : undefined;
  const projectId = params.get("projectId") ?? undefined;
  const personTasks = dimension === "tasks" && Boolean(params.get("personId"));
  const responsiblePersonTasks =
    personTasks && (params.get("relation") ?? "RESPONSIBLE") === "RESPONSIBLE";
  const taskView =
    params.get("taskView") ?? (responsiblePersonTasks ? "CURRENT" : "ALL");
  const taskSort =
    params.get("taskSort") ?? (responsiblePersonTasks ? "FOLLOW_UP" : "NEWEST");
  const stockTasks = dimension === "tasks" && taskView !== "ALL";
  const tableColumns =
    personTasks && taskView !== "ALL" ? personTaskColumns : columns[dimension];
  function update(
    values: Record<string, string | undefined>,
    resetPage = true,
  ) {
    const next = new URLSearchParams(navigationQuery.current);
    if (resetPage) next.delete("page");
    for (const [key, value] of Object.entries(values)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    navigationQuery.current = next.toString();
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  function switchTab(value: string) {
    update({
      tab: value,
      ...(value === "people"
        ? { personId: undefined, relation: undefined }
        : {}),
      week: undefined,
      taskView: undefined,
      taskSort: undefined,
      status: undefined,
      role: undefined,
      exception: undefined,
      phase: undefined,
      priority: undefined,
      q: undefined,
    });
    setSearch("");
  }
  useEffect(() => {
    setSearch(params.get("q") ?? "");
  }, [params]);
  useEffect(() => {
    if (["overview", "weekly"].includes(dimension)) return;
    const abort = new AbortController();
    const epoch = ++request.current;
    setLoading(true);
    setError("");
    setData(undefined);
    fetch(`/api/dashboard/insights?${encoded}`, { signal: abort.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "统计查询失败");
        if (!abort.signal.aborted && epoch === request.current) {
          setData(result);
          setLoadedQuery(encoded);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && epoch === request.current)
          setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted && epoch === request.current)
          setLoading(false);
      });
    return () => abort.abort();
  }, [dimension, encoded, revision]);
  async function exportPage() {
    setBusy(true);
    try {
      const response = await fetch("/api/dashboard/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new URLSearchParams(encoded))),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `decision-${dimension}-page-${params.get("page") ?? 1}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify("本页数据已导出并记录审计");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function title(row: DecisionRow) {
    if (dimension === "people")
      return (
        <button
          className="border-0 p-0 font-semibold text-teal-800 underline-offset-4 hover:underline"
          onClick={() =>
            update({
              personId: String(row.id),
              tab: "tasks",
              taskView: "CURRENT",
              taskSort: "FOLLOW_UP",
              dateField: "STOCK",
              role: undefined,
              q: undefined,
              status: undefined,
              exception: undefined,
              phase: undefined,
              priority: undefined,
              relation: "RESPONSIBLE",
            })
          }
        >
          {row.title}
          <span className="mt-1 block text-xs font-normal text-slate-400">
            {row.role} · {row.email}
          </span>
        </button>
      );
    const href =
      dimension === "projects"
        ? `/projects/${row.id}/board`
        : dimension === "tasks"
          ? `/tasks/${row.id}`
          : `/projects/${row.projectId}/requirements?q=${encodeURIComponent(String(row.title))}`;
    return role === "PMO" ? (
      <span className="font-medium">{row.title}</span>
    ) : (
      <Link className="font-semibold text-teal-800 hover:underline" href={href}>
        {row.title}
      </Link>
    );
  }
  function cell(row: DecisionRow, key: string) {
    if (key === "title") return title(row);
    if (key === "taskAction")
      return role === "PMO" ? (
        "仅统计"
      ) : (
        <Link
          className="font-medium text-teal-800 underline"
          href={`/tasks/${row.id}`}
        >
          查看任务
        </Link>
      );
    if (key === "overdueDays")
      return Number(row.overdueDays) > 0 ? (
        <span className="font-semibold text-rose-700">
          {row.overdueDays} 天
        </span>
      ) : (
        "—"
      );
    if (["status", "projectStatus"].includes(key))
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <State
            value={
              dimension === "requirements" && !Number(row.managed)
                ? "LEGACY"
                : row[key]
            }
          />
          {dimension === "tasks" &&
            key === "status" &&
            Number(row.overdueDays) > 0 && (
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                已逾期
              </span>
            )}
        </span>
      );
    if (key === "progress") {
      const total = Number(row.taskTotal);
      const done = Number(row.taskDone);
      const percent = total ? Math.round((done / total) * 100) : 0;
      return (
        <div className="min-w-28">
          <div className="mb-1 text-xs text-slate-500">
            {done} / {total} {total ? `· ${percent}%` : "· 未建立计划"}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              style={{ width: `${percent}%` }}
              className="h-full rounded-full bg-gradient-to-r from-teal-700 to-teal-300"
            />
          </div>
        </div>
      );
    }
    if (["dueDate", "completedAt"].includes(key))
      return row[key]
        ? String(row[key]).slice(0, 10)
        : dimension === "tasks" && key === "dueDate"
          ? "未排期"
          : "未记录";
    if (key === "statusSince")
      return row[key]
        ? new Date(String(row[key])).toLocaleDateString("zh-CN", {
            timeZone: "Asia/Hong_Kong",
          })
        : "未知";
    const value = row[key];
    return value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
        : value;
  }
  const selected = dimension as DecisionQuery["dimension"];
  const statuses =
    selected === "projects"
      ? [
          "PLANNING",
          "ACTIVE",
          "ON_HOLD",
          "PENDING_ACCEPTANCE",
          "ARCHIVED",
          "CANCELLED",
          "COMPLETED",
        ]
      : selected === "tasks"
        ? ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]
        : selected === "requirements"
          ? [
              "DRAFT",
              "IN_REVIEW",
              "APPROVED",
              "IMPLEMENTING",
              "VERIFYING",
              "CUSTOMER_CONFIRMATION",
              "CLOSED",
              "CANCELLED",
            ]
          : ["ACTIVE", "DISABLED", "PENDING"];
  return (
    <div className="space-y-6">
      <nav
        aria-label="决策中心维度"
        className="flex flex-wrap gap-2 rounded-2xl border border-white bg-white/80 p-2 shadow-sm"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-pressed={dimension === t.id}
            className={`flex items-center gap-2 rounded-xl border-0 px-5 py-3 text-sm font-medium ${dimension === t.id ? "bg-teal-800 text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-teal-50"}`}
            onClick={() => switchTab(t.id)}
          >
            <t.icon className="size-4" />
            {t.name}
          </button>
        ))}
      </nav>
      {dimension === "overview" ? (
        <Dashboard role={role} projectId={projectId} />
      ) : dimension === "weekly" ? (
        <section className="space-y-5 rounded-2xl border bg-white/80 p-6">
          <h1 className="text-2xl font-semibold">周报与交付跟进</h1>
          <div className="flex flex-wrap items-center gap-3">
            <label>
              周内日期{" "}
              <input
                type="date"
                value={params.get("week") ?? today()}
                onChange={(e) => update({ week: e.target.value })}
              />
            </label>
            <Link
              href={
                params.get("personId")
                  ? `/weekly-reports?authorId=${params.get("personId")}`
                  : "/weekly-reports"
              }
              className="font-medium text-teal-800 underline"
            >
              进入个人周报与阅知台账 →
            </Link>
          </div>
          <WeeklySummary
            week={params.get("week") ?? today()}
            projectId={projectId}
            authorId={params.get("personId") ?? undefined}
            role={params.get("reportRole") ?? undefined}
          />
          <p className="text-sm text-slate-500">
            项目负责人仅统计所负责项目分区。周报进展与系统业务状态并列展示，文字陈述不会自动改变任务或需求。
          </p>
        </section>
      ) : (
        <>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-widest text-teal-700">
                DELIVERY INTELLIGENCE
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                {tabs.find((t) => t.id === dimension)?.name}决策视图
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {role === "PM"
                  ? "仅展示你负责或参与项目范围内的数据"
                  : "全局交付视角"}{" "}
                · 当前存量与期间事件分开解释
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={loading || busy}
                onClick={() => setRevision((v) => v + 1)}
              >
                <RefreshCw className="size-4" />
                刷新
              </button>
              <button disabled={!data || busy || loading} onClick={exportPage}>
                <Download className="size-4" />
                导出本页 JSON
              </button>
            </div>
          </header>
          <form
            className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search || undefined });
            }}
          >
            <label className="text-xs text-slate-500">
              搜索
              <div className="mt-1 flex items-center gap-2">
                <Search className="size-4" />
                <input
                  aria-label="搜索统计明细"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    dimension === "people" ? "姓名或账号" : "名称关键字"
                  }
                />
              </div>
            </label>
            <button>查询</button>
            <label className="text-xs text-slate-500">
              项目
              <select
                aria-label="统计项目"
                className="mt-1 block max-w-64"
                value={projectId ?? ""}
                onChange={(e) => update({ projectId: e.target.value })}
              >
                <option value="">权限内全部项目</option>
                {data?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              状态
              <select
                className="mt-1 block"
                value={params.get("status") ?? ""}
                onChange={(e) =>
                  update({
                    status: e.target.value,
                    ...(stockTasks &&
                    ["DONE", "CANCELLED"].includes(e.target.value)
                      ? { taskView: "ALL" }
                      : {}),
                  })
                }
              >
                <option value="">
                  {dimension === "tasks" || dimension === "requirements"
                    ? "全部有效状态"
                    : "全部状态"}
                </option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
            </label>
            {dimension === "people" ? (
              <label className="text-xs text-slate-500">
                当前系统角色
                <select
                  className="mt-1 block"
                  value={params.get("role") ?? ""}
                  onChange={(e) => update({ role: e.target.value })}
                >
                  <option value="">全部角色</option>
                  {["PM", "QA", "MEMBER", "ADMIN", "PMO"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="text-xs text-slate-500">
                  统计时间口径
                  <select
                    className="mt-1 block"
                    disabled={stockTasks}
                    value={
                      stockTasks
                        ? "STOCK"
                        : (params.get("dateField") ?? "STOCK")
                    }
                    onChange={(e) => update({ dateField: e.target.value })}
                  >
                    <option value="STOCK">当前存量</option>
                    <option value="CREATED">期间新建</option>
                    <option value="COMPLETED">期间完成 / 归档</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  起始日期
                  <input
                    type="date"
                    className="mt-1 block"
                    value={params.get("from") ?? defaultFrom()}
                    onChange={(e) => update({ from: e.target.value })}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  截止日期
                  <input
                    type="date"
                    className="mt-1 block"
                    value={params.get("to") ?? today()}
                    onChange={(e) => update({ to: e.target.value })}
                  />
                </label>
              </>
            )}
            {["tasks", "requirements"].includes(dimension) && (
              <label className="text-xs text-slate-500">
                异常筛选
                <select
                  className="mt-1 block"
                  value={params.get("exception") ?? "ALL"}
                  onChange={(e) => update({ exception: e.target.value })}
                >
                  <option value="ALL">全部</option>
                  <option value="OVERDUE">活跃项目逾期</option>
                  <option value="UNASSIGNED">未分配</option>
                  {dimension === "tasks" && (
                    <>
                      <option value="BLOCKED">受阻</option>
                      <option value="UNSCHEDULED">待排期</option>
                      <option value="MISSING_DELIVERABLE">交付物缺口</option>
                    </>
                  )}
                </select>
              </label>
            )}
            {dimension === "requirements" && (
              <label className="text-xs text-slate-500">
                优先级
                <select
                  className="mt-1 block"
                  value={params.get("priority") ?? ""}
                  onChange={(e) => update({ priority: e.target.value })}
                >
                  <option value="">全部</option>
                  {["MUST", "SHOULD", "COULD", "LATER"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => {
                router.replace("/dashboard?tab=" + dimension, {
                  scroll: false,
                });
                setSearch("");
              }}
            >
              清除筛选
            </button>
          </form>
          {params.get("personId") && (
            <section className="rounded-xl border border-teal-200 bg-teal-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {data?.person?.name ?? "人员职责查询"}
                  </h2>
                  <p className="mt-1 text-xs text-teal-800">
                    当前角色 {data?.person?.role ?? "—"} ·{" "}
                    {labels[data?.person?.status ?? ""] ?? "权限范围内查询"} ·
                    不以当前角色推断历史职责
                  </p>
                </div>
                <button
                  onClick={() =>
                    update({
                      personId: undefined,
                      relation: undefined,
                      taskView: undefined,
                      taskSort: undefined,
                    })
                  }
                >
                  退出人员查询
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {["projects", "tasks", "requirements"].map((d) => (
                  <button
                    key={d}
                    aria-pressed={dimension === d}
                    onClick={() => switchTab(d)}
                  >
                    {tabs.find((t) => t.id === d)?.name}明细
                  </button>
                ))}
                <select
                  aria-label="人员职责类型"
                  value={params.get("relation") ?? "RESPONSIBLE"}
                  onChange={(e) =>
                    update({
                      relation: e.target.value,
                      taskView: undefined,
                      taskSort: undefined,
                      status: undefined,
                      exception: undefined,
                    })
                  }
                >
                  <option value="RESPONSIBLE">当前负责</option>
                  <option value="PARTICIPATING">项目参与</option>
                  <option value="HANDLED">历史办理</option>
                </select>
              </div>
              {personTasks && (
                <div className="mt-4 space-y-3 border-t border-teal-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {responsiblePersonTasks &&
                      (
                        [
                          ["CURRENT", "当前待跟进", data?.personTasks?.current],
                          ["FROZEN", "冻结积压", data?.personTasks?.frozen],
                          ["ALL", "全部任务", undefined],
                        ] as const
                      ).map(([value, label, count]) => (
                        <button
                          key={value}
                          aria-label={label}
                          aria-pressed={taskView === value}
                          className={`rounded-lg px-3 py-2 text-sm ${taskView === value ? "border-teal-800 bg-teal-800 text-white" : "border-teal-200 bg-white text-teal-900"}`}
                          onClick={() =>
                            update({
                              taskView: value,
                              status: undefined,
                              exception: undefined,
                              dateField: "STOCK",
                            })
                          }
                        >
                          {label}
                          {value !== "ALL" && (
                            <span className="ml-2 tabular-nums">
                              {count ?? "—"}
                            </span>
                          )}
                        </button>
                      ))}
                    <label className="ml-auto flex items-center gap-2 text-xs text-teal-900">
                      任务排序
                      <select
                        aria-label="任务排序"
                        value={taskSort}
                        onChange={(e) => update({ taskSort: e.target.value })}
                      >
                        <option value="FOLLOW_UP">逾期优先，进行中其次</option>
                        <option value="NEWEST">最近创建</option>
                      </select>
                    </label>
                  </div>
                  <p className="text-xs leading-5 text-teal-800">
                    {stockTasks
                      ? "按当前存量查看，较早创建的未完成任务也会保留；上方日期仅筛选历史办理记录。"
                      : "全部任务默认排除已取消；可通过状态筛选查看取消记录，或按新建/完成日期查询历史。"}
                  </p>
                </div>
              )}
            </section>
          )}
          {loading ? (
            <div
              aria-label="统计加载中"
              className="grid animate-pulse gap-4 sm:grid-cols-3"
            >
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-white" />
              ))}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 p-6"
            >
              <h2 className="font-semibold">暂时无法读取统计</h2>
              <p className="mt-2 text-sm">{error}</p>
              <button
                className="mt-3"
                onClick={() => setRevision((v) => v + 1)}
              >
                重试
              </button>
            </div>
          ) : (
            data && (
              <>
                {personTasks ? (
                  data.personTasks && (
                    <section
                      aria-label="人员当前任务概况"
                      className="grid gap-3 sm:grid-cols-3"
                    >
                      {(
                        [
                          [
                            "进行中任务",
                            data.personTasks.inProgress,
                            "text-teal-900",
                          ],
                          [
                            "逾期任务",
                            data.personTasks.overdue,
                            "text-rose-700",
                          ],
                          [
                            "受阻任务",
                            data.personTasks.blocked,
                            "text-amber-800",
                          ],
                        ] as const
                      ).map(([label, count, color]) => (
                        <article
                          key={label}
                          className="rounded-xl border bg-white px-5 py-4"
                        >
                          <h2 className="text-sm text-slate-500">{label}</h2>
                          <p
                            className={`mt-2 text-2xl font-semibold tabular-nums ${color}`}
                          >
                            {count}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            当前负责 · 可执行项目 · 同一任务可能同时逾期
                          </p>
                        </article>
                      ))}
                    </section>
                  )
                ) : (
                  <DecisionStatistics data={data} dimension={dimension} />
                )}
                <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex justify-between border-b p-5">
                    <h2 className="font-semibold">
                      {personTasks
                        ? taskView === "CURRENT"
                          ? "当前待跟进任务"
                          : taskView === "FROZEN"
                            ? "冻结项目积压任务"
                            : "人员全部任务"
                        : params.get("personId")
                          ? "人员职责明细"
                          : "业务明细"}
                    </h2>
                    <span className="text-sm text-slate-500">
                      共 {data.total} 条
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          {tableColumns?.map(([key, label]) => (
                            <th
                              key={key}
                              className={`whitespace-nowrap px-4 py-3 font-medium ${key === "title" ? "sticky left-0 z-10 bg-slate-50" : ""}`}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.rows.map((row) => (
                          <tr
                            key={String(row.id)}
                            className="hover:bg-teal-50/30"
                          >
                            {tableColumns?.map(([key]) => (
                              <td
                                key={key}
                                className={`px-4 py-4 align-top tabular-nums ${key === "title" ? "sticky left-0 min-w-56 max-w-80 bg-white" : "whitespace-nowrap text-slate-600"}`}
                              >
                                {cell(row, key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.rows.length && (
                      <p className="p-12 text-center text-slate-500">
                        当前筛选下暂无数据。
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t p-4 text-sm">
                    <button
                      disabled={data.page === 1}
                      onClick={() =>
                        update({ page: String(data.page - 1) }, false)
                      }
                    >
                      上一页
                    </button>
                    <span className="text-slate-500">
                      第 {data.page} / {Math.max(1, Math.ceil(data.total / 20))}{" "}
                      页
                    </span>
                    <button
                      disabled={data.page * 20 >= data.total}
                      onClick={() =>
                        update({ page: String(data.page + 1) }, false)
                      }
                    >
                      下一页
                    </button>
                  </div>
                </section>
                {personTasks && (
                  <details
                    className="rounded-xl border bg-white p-5"
                    key={`statistics-${params.get("personId")}`}
                  >
                    <summary className="cursor-pointer font-semibold">
                      任务统计与状态分布
                    </summary>
                    <div className="mt-5">
                      <DecisionStatistics data={data} dimension={dimension} />
                    </div>
                  </details>
                )}
                {params.get("personId") && (
                  <section className="rounded-xl border bg-white p-5">
                    <details key={`history-${params.get("personId")}`}>
                      <summary className="cursor-pointer font-semibold">
                        历史办理记录
                        <span className="ml-3 text-xs font-normal text-slate-500">
                          所选期间最近 20 条 · 点击展开
                        </span>
                      </summary>
                      <p className="mt-1 text-xs text-slate-500">
                        最近 20
                        条。只展示有审计证据的办理；没有历史角色证据时明确标为未知。
                      </p>
                      <div className="mt-4 divide-y">
                        {data.events.map((event) => (
                          <div
                            key={String(event.id)}
                            className="flex flex-wrap justify-between gap-3 py-3 text-sm"
                          >
                            <span>
                              {event.projectName} ·{" "}
                              {handlingLabels[String(event.title)] ??
                                event.title}
                            </span>
                            <span className="w-full text-xs text-slate-400">
                              {role === "ADMIN" ? (
                                <Link
                                  className="text-teal-800 underline"
                                  href={`/audit/records/${event.id}`}
                                >
                                  查看审计证据
                                </Link>
                              ) : (
                                `审计编号：${event.id}`
                              )}
                            </span>
                            <span className="text-slate-500">
                              操作时角色：
                              {event.roleAtEvent ?? "未知（历史未记录）"} ·{" "}
                              {new Date(String(event.createdAt)).toLocaleString(
                                "zh-CN",
                                { timeZone: "Asia/Hong_Kong" },
                              )}
                            </span>
                          </div>
                        ))}
                        {!data.events.length && (
                          <p className="py-5 text-sm text-slate-500">
                            所选期间没有可见的办理记录。
                          </p>
                        )}
                      </div>
                    </details>
                    <Link
                      className="mt-4 inline-block text-sm text-teal-800 underline"
                      href={`/weekly-reports?authorId=${params.get("personId")}`}
                    >
                      查看权限内的人员周报 →
                    </Link>
                  </section>
                )}
                {dimension === "projects" && !params.get("personId") && (
                  <section className="rounded-xl border bg-white p-5">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">已采集的历史存量</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          每天首次观测值，最长显示 92
                          个采集日；不代表每日结束值。
                        </p>
                      </div>
                      {role !== "PM" && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await fetch(
                                "/api/dashboard/snapshots",
                                { method: "POST" },
                              );
                              const result = await r.json();
                              if (!r.ok) throw new Error(result.error);
                              notify(
                                `已采集 ${result.inserted} 个项目；同日快照不会覆盖`,
                              );
                              setRevision((v) => v + 1);
                            } catch (e) {
                              notify((e as Error).message, "error");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          采集今日快照
                        </button>
                      )}
                    </div>
                    <div className="mt-4 max-h-64 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr>
                            {[
                              "采集日期",
                              "有效任务",
                              "已完成",
                              "执行项目逾期",
                              "未关闭需求",
                            ].map((h) => (
                              <th
                                key={h}
                                className="py-2 font-medium text-slate-500"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.observations.map((o) => (
                            <tr key={o.day} className="border-t">
                              <td className="py-2">{o.day}</td>
                              <td>{o.taskTotal}</td>
                              <td>{o.taskDone}</td>
                              <td>{o.overdueTasks}</td>
                              <td>{o.openRequirements}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!data.observations.length && (
                        <p className="py-5 text-sm text-slate-500">
                          尚未采集快照，不能从今天的数据反推历史存量。
                        </p>
                      )}
                    </div>
                  </section>
                )}
                <details className="rounded-xl border bg-white/60 p-4 text-sm text-slate-500">
                  <summary className="cursor-pointer font-medium">
                    指标定义与数据边界
                  </summary>
                  <ul className="mt-3 list-disc space-y-2 pl-5">
                    {data.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </details>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
