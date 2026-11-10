"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast-provider";
type Row = {
  authorId: string;
  author: { name: string; email: string };
  role: string;
  deadline: string;
  exemptReason: string | null;
  submittedAt: string | null;
  state: string;
};
export function WeeklyRoster({
  week,
  onChange,
}: {
  week: string;
  onChange: () => void;
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Row[] }>();
  const [error, setError] = useState("");
  const [exempt, setExempt] = useState<{ authorId: string; reason: string }>();
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setData(undefined);
    fetch(`/api/weekly-reports/roster?week=${week}&page=${page}`, {
      signal: abort.signal,
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setData(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [week, page, revision]);
  return (
    <details className="rounded-xl border bg-white p-5">
      <summary className="cursor-pointer font-semibold">
        应报人员与豁免台账（全局管理）
      </summary>
      {error && <p role="alert">{error}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {["人员", "采集时角色", "报送情况", "管理操作"].map((h) => (
                <th key={h} className="p-2 text-slate-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.authorId} className="border-t">
                <td className="p-2">
                  {row.author.name}
                  <span className="block text-xs text-slate-400">
                    {row.author.email}
                  </span>
                </td>
                <td>{row.role}</td>
                <td>
                  {row.exemptReason
                    ? `已豁免：${row.exemptReason}`
                    : !row.submittedAt
                      ? "未报"
                      : `${new Date(row.submittedAt) > new Date(row.deadline) ? "迟报" : "准时"}${row.state === "RETURNED" ? " · 待补充" : ""}`}
                </td>
                <td>
                  <button
                    disabled={busy || Boolean(row.exemptReason)}
                    onClick={() =>
                      setExempt({ authorId: row.authorId, reason: "" })
                    }
                  >
                    登记豁免
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.rows.length === 0 && (
          <p className="py-6 text-sm text-slate-500">
            该周没有应报人员快照，不补造历史名单。
          </p>
        )}
      </div>
      {exempt && (
        <form
          className="mt-4 rounded-lg bg-amber-50 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await fetch("/api/weekly-reports/exempt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...exempt, week }),
              });
              const result = await r.json();
              if (!r.ok) throw new Error(result.error);
              setExempt(undefined);
              setRevision((v) => v + 1);
              onChange();
              notify("豁免已登记并记录审计");
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            豁免说明
            <textarea
              autoFocus
              required
              minLength={5}
              maxLength={500}
              value={exempt.reason}
              className="mt-2 w-full"
              onChange={(e) => setExempt({ ...exempt, reason: e.target.value })}
            />
          </label>
          <button disabled={busy}>确认登记</button>
          <button type="button" onClick={() => setExempt(undefined)}>
            取消
          </button>
        </form>
      )}
      <div className="mt-3 flex justify-between">
        <button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
          上一页
        </button>
        <span className="text-xs text-slate-500">第 {page} 页</span>
        <button
          disabled={!data || page * 20 >= data.total}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页
        </button>
      </div>
    </details>
  );
}
