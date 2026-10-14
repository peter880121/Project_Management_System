"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function UserDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
    <h2 id={titleId} className="mb-5 text-xl font-semibold">{title}</h2>{children}
  </dialog>;
}
