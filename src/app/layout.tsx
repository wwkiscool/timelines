import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOMENT 一瞬 — 此刻，正在发生",
  description: "一条不断向前的时间线。以毫秒感受时间的流动，留住属于你的每个瞬间。",
  applicationName: "MOMENT 一瞬",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050b18",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" style={{ backgroundColor: "#050b18", colorScheme: "dark" }}><body style={{ margin: 0, backgroundColor: "#050b18", color: "#e3efff" }}>{children}</body></html>;
}
