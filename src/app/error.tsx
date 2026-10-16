"use client";

import { LayoutUnavailable, LayoutFailureNotice } from "@/components/layout/layout-failure";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <LayoutFailureNotice><LayoutUnavailable retry={reset} /></LayoutFailureNotice>;
}
