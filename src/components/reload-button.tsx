"use client";

export function ReloadButton() {
  return <button type="button" className="text-teal-800 underline" onClick={() => window.location.reload()}>重新加载</button>;
}
