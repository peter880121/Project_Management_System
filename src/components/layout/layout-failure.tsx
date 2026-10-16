"use client";

import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const LayoutFailureContext = createContext<{ failed: boolean; setFailed: (failed: boolean) => void }>({ failed: false, setFailed: () => {} });
export const useLayoutFailure = () => useContext(LayoutFailureContext);

export function LayoutFailureNotice({ children }: { children: ReactNode }) {
  const { setFailed } = useLayoutFailure();
  useLayoutEffect(() => { setFailed(true); return () => setFailed(false); }, [setFailed]);
  return children;
}

export function LayoutUnavailable({ retry }: { retry?: () => void }) {
  return <div role="alert" className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-5 px-6 py-16">
    <AlertCircle aria-hidden="true" className="h-10 w-10 text-amber-700" />
    <h1 className="text-2xl font-semibold">暂时无法加载，请重试</h1>
    <p className="text-sm leading-7 text-slate-600">暂时无法确认登录状态或读取页面数据，请稍后重新加载。</p>
    <Button type="button" variant="outline" onClick={retry ?? (() => window.location.reload())}><RotateCw aria-hidden="true" className="mr-2 h-4 w-4" />重新加载</Button>
  </div>;
}
