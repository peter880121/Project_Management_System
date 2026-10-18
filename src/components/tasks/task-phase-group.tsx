import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { PROJECT_PHASES } from "@/modules/projects/task-phases";

export function TaskPhaseGroup({ id, phase, count, open, onToggle, children }: {
  id: string; phase: string; count: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  const index = PROJECT_PHASES.indexOf(phase);
  return <section aria-label={`${phase}阶段`} className={`space-y-2 rounded-xl ${open ? "pb-2" : ""}`}>
    <h3><button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border-0 px-2.5 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-teal-600 ${open ? "bg-teal-50/80 text-teal-900" : "bg-white/70 text-slate-600 hover:bg-white"}`}>
      <span className="flex min-w-0 items-center gap-2"><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-medium tabular-nums ${open ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-400"}`}>{index < 0 ? "·" : String(index + 1).padStart(2, "0")}</span><span className="truncate">{phase}</span></span><span className="shrink-0 text-[10px] font-normal text-slate-500">{count} 项</span>
    </button></h3>
    <div id={id} hidden={!open} className="space-y-2.5">{children}</div>
  </section>;
}
