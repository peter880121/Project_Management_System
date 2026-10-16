"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { clearBreadcrumbs, resetBreadcrumbs, visibleBreadcrumbs, type BreadcrumbItem, type BreadcrumbRegistration } from "./breadcrumbs";

const BreadcrumbContext = createContext<{ items: BreadcrumbItem[]; register: (value: BreadcrumbRegistration) => () => void }>({ items: [], register: () => () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [registration, setRegistration] = useState<BreadcrumbRegistration | null>(null);
  useEffect(() => { setRegistration(previous => resetBreadcrumbs(previous, pathname)); }, [pathname]);
  const register = useCallback((value: BreadcrumbRegistration) => {
    setRegistration(value);
    return () => setRegistration(previous => clearBreadcrumbs(previous, value.owner));
  }, []);
  const value = useMemo(() => ({ items: visibleBreadcrumbs(registration, pathname), register }), [registration, pathname, register]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export const useBreadcrumbs = () => useContext(BreadcrumbContext);
