import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "AgriMonitor", description: "Agricultural field intelligence" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><body>{children}</body></html>; }
