import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BigWarn | Real-Time BD News Stream & Disruption Lakehouse",
  description:
    "High-throughput real-time crawler, Kafka/Spark ELT Lakehouse, and Edge PWA alert platform for Bangladesh local disruptions.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#064e3b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/30 selection:text-primary-foreground font-sans">
        <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md px-4 lg:px-8 py-3">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-amber-500 shadow-md shadow-emerald-950/40">
                <span className="text-xl font-black text-black">BW</span>
                <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background"></span>
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-foreground">
                    BigWarn <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">Super-Streamer</span>
                  </h1>
                  <span className="hidden sm:inline-block text-xs text-muted-foreground border-l border-border pl-2">
                    45 BD Portals &bull; Lakehouse ELT &bull; Edge PWA
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Apache Spark Streaming &bull; Medallion Delta Storage &bull; Edge Corridor Alerting
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card/60 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Kafka Producer Active</span>
              </div>
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card/60 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-sky-500"></span>
                <span>Spark Medallion Sync</span>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 lg:px-8 py-6">{children}</main>

        <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
          <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>
              BigWarn Architecture &copy; {new Date().getFullYear()} &bull; Dhaka Timezone (UTC+6) &bull; Edge Privacy First
            </p>
            <p className="font-mono text-[11px] text-muted-foreground/80">
              ELT Stages: Bronze (Raw Append) &rarr; Silver (Dedup + Geocoding) &rarr; Gold (Credibility Clusters)
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

