"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

type ActionLock = { busy: boolean; acquire: () => boolean; release: () => void };
const Context = createContext<ActionLock | null>(null);
function useLocalLock(): ActionLock {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  return { busy, acquire: () => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); return true;
  }, release: () => { lock.current = false; setBusy(false); } };
}
export function AccountActionProvider({ children }: { children: ReactNode }) {
  const lock = useLocalLock();
  return <Context.Provider value={lock}>{children}</Context.Provider>;
}
export function useAccountActionLock() {
  const shared = useContext(Context);
  const local = useLocalLock();
  return shared ?? local;
}
