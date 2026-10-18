"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AiStreamError, readAiResponse, Typewriter } from "@/modules/ai/streaming/client";
import { useToast } from "./toast-provider";

export function useAiGeneration<T>() {
  const router = useRouter(); const { notify } = useToast();
  const controller = useRef<AbortController | null>(null); const version = useRef(0);
  const animation = useRef<Typewriter | null>(null);
  const mounted = useRef(true);
  const [running, setRunning] = useState(false); const [preview, setPreview] = useState("");
  const [stage, setStage] = useState(""); const [stopped, setStopped] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const cancel = useCallback(() => { ++version.current; controller.current?.abort(); animation.current?.stop(); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, [cancel]);
  const stop = useCallback(() => { cancel(); setRunning(false); setStopped(true); setRetrying(false); setStage("已停止生成；若结果已进入保存阶段，请核对待确认列表"); }, [cancel]);
  const execute = useCallback(async (url: string, body: unknown): Promise<T | null> => {
    cancel(); const current = version.current; const request = new AbortController(); controller.current = request;
    const id = crypto.randomUUID(); setLastId(id); setRunning(true); setStopped(false); setRetrying(false); setPreview(""); setStage("正在准备生成…");
    const writer = new Typewriter(value => { if (mounted.current && version.current === current) setPreview(text => text + value); }); animation.current = writer;
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Generation-Id": id }, body: JSON.stringify(body), signal: request.signal });
      const result = await readAiResponse<T>(response, request.signal, event => {
        if (version.current !== current) return;
        if (event.event === "delta") writer.enqueue(event.data.text);
        if (event.event === "progress") { setStage(event.data.message); setRetrying(event.data.stage === "retrying"); }
      });
      if (!mounted.current || current !== version.current) return null;
      writer.finish(); setStage("生成完成，结果待人工确认"); return result;
    } catch (error) {
      writer.stop();
      if (request.signal.aborted || current !== version.current || !mounted.current) return null;
      setRetrying(false); setStage(error instanceof Error ? error.message : "生成失败，请重试");
      if (error instanceof AiStreamError && error.code === "UNAUTHORIZED") {
        setPreview(""); setStage("访问权限已变化，生成已停止");
        notify(error.message, "error");
        // Refresh session state; project-only revocation must not be misreported as a logout.
        const session = await fetch("/api/auth/me", { cache: "no-store", signal: request.signal }).catch(() => null);
        if (request.signal.aborted || current !== version.current || !mounted.current) return null;
        if (session?.status === 401) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        else router.refresh();
      }
      throw error;
    } finally { writer.stop(); if (mounted.current && current === version.current) setRunning(false); }
  }, [cancel, notify, router]);
  return { execute, stop, running, preview, stage, stopped, retrying, lastId };
}
