import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BigWarn Edge | Bangladesh Road Alerts & App Portal",
  description:
    "Get BigWarn Edge for Android (APK) or Apple iPhone (Web App PWA) for real-time Bangladesh road disruption alerts and safe routing.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#121312",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#121312] text-[#ecebe6] antialiased selection:bg-[#3b3820] selection:text-[#ecebe6] font-sans">
        {children}
      </body>
    </html>
  );
}
