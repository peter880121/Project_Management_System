"use client";
import { useEffect } from "react";
const eventName = "project-tasks-changed";
export function announceTaskCreated(projectId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { projectId } }));
  if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(eventName); channel.postMessage({ projectId }); channel.close(); }
}
export function useProjectTaskRefresh(projectId: string, load: () => Promise<void>) {
  useEffect(() => {
    const reload = () => { void load().catch(() => {}); };
    const local = (event: Event) => { if (event instanceof CustomEvent && event.detail?.projectId === projectId) reload(); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(eventName) : null;
    if (channel) channel.onmessage = event => { if (event.data?.projectId === projectId) reload(); };
    window.addEventListener(eventName, local);
    // Covers a suspended tab which missed its broadcast.
    window.addEventListener("focus", reload);
    return () => { channel?.close(); window.removeEventListener(eventName, local); window.removeEventListener("focus", reload); };
  }, [projectId, load]);
}
