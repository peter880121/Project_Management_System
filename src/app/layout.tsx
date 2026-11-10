import type { Metadata } from "next";
import "./globals.css";
// Load scoped chart styles with the application shell, before lazy chart JavaScript.
import "@/components/planning/gantt-scoped.css";
import "@/components/planning/gantt-overrides.css";
import { AppHeader } from "@/components/app-header";
import { AccountActionProvider } from "@/components/account-action-lock";
import { BreadcrumbProvider } from "@/components/layout/breadcrumb-context";
import { ToastProvider } from "@/components/toast-provider";

export const metadata: Metadata = {
  title: "MedPM-AI",
  description: "合规、可追溯的医疗软件交付工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><ToastProvider><AccountActionProvider><BreadcrumbProvider><AppHeader>{children}</AppHeader></BreadcrumbProvider></AccountActionProvider></ToastProvider></body></html>;
}
