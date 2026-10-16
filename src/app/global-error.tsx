"use client";

import { LayoutUnavailable } from "@/components/layout/layout-failure";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="zh-CN"><body><LayoutUnavailable retry={reset} /></body></html>;
}
