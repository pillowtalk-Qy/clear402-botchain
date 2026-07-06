import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Clear402 Evidence Dashboard",
  description: "Runtime-backed operator console for Clear402 x402 guard evidence."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
