import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { AccountActionProvider } from "@/components/account-action-lock";
import { BreadcrumbProvider } from "@/components/layout/breadcrumb-context";

export const metadata: Metadata = {
  title: "MedPM-AI",
  description: "合规、可追溯的医疗软件交付工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><AccountActionProvider><BreadcrumbProvider><AppHeader>{children}</AppHeader></BreadcrumbProvider></AccountActionProvider></body></html>;
}
