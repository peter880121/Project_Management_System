"use client";

import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">{pending ? pendingLabel : label}</Button>;
}
