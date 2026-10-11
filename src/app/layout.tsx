import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedPM-AI",
  description: "合规、可追溯的医疗软件交付工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
