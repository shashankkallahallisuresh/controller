import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Remote Controller",
  description: "Control Claude Code from your phone",
  manifest: "/manifest.json",
  themeColor: "#0b0f14",
  appleWebApp: {
    capable: true,
    title: "Claude Remote",
    statusBarStyle: "black-translucent"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }`}
        </Script>
      </body>
    </html>
  );
}
