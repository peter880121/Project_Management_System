"use client";

import { useLayoutEffect } from "react";
import { useBreadcrumbs } from "./breadcrumb-context";
import type { BreadcrumbItem } from "./breadcrumbs";

// Labels and the owning path come from the Server Component, never from client-side ID lookups.
export function PageBreadcrumbs({ pathname, items }: { pathname: string; items: BreadcrumbItem[] }) {
  const { register } = useBreadcrumbs();
  useLayoutEffect(() => register({ pathname, items, owner: Symbol(pathname) }), [pathname, items, register]);
  return null;
}
