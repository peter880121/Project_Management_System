import Link from "next/link";
export function SourceAuditLinks({ ids }: { ids: string[] }) {
  const links = (values: string[], start: number) =>
    values.map((id, index) => (
      <Link
        key={id}
        href={`/audit/records/${id}`}
        className="mr-4 inline-block text-sm text-teal-800 underline"
      >
        审计记录 {start + index + 1}
      </Link>
    ));
  return (
    <div className="space-y-2">
      {links(ids.slice(0, 3), 0)}
      {ids.length > 3 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">
            其余 {ids.length - 3} 条来源审计
          </summary>
          <div className="mt-2">{links(ids.slice(3), 3)}</div>
        </details>
      )}
    </div>
  );
}
