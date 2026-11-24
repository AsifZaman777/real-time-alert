# Frontend Web Console, Responsive Mobile Layout & Vercel Guide

This document covers the **BigWarn Next.js 14 Web Observatory & Lakehouse Console** (`real-time-alert/frontend/`), its responsive mobile-first design, server-side stream proxy, and deployment workflow.

---

## 1. Frontend Architecture & Key Files

| File | Responsibility |
| :--- | :--- |
| [src/app/page.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/app/page.tsx) | Main observatory dashboard featuring top KPI strip, collapsible mobile search/filter drawer, desktop table + mobile card feed (`md:hidden`), and fixed bottom mobile thumb-navigation bar (`sm:hidden`). |
| [src/components/features/lakehouse/medallion-explorer.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/components/features/lakehouse/medallion-explorer.tsx) | **Live Medallion ELT Analytics Dashboard** & table explorer featuring real-time `Bronze`, `Silver`, and `Gold` KPI cards, vertical grouped column chart, horizontal ELT reduction funnel, SVG multi-segment donut chart, live time-series area/line graph, disruption category breakdown chart, and responsive Gold alert cards. |
| [src/components/features/debug/site-matrix-and-logs.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/components/features/debug/site-matrix-and-logs.tsx) | 45-portal scraper health matrix (`2-col` compact grid on mobile, `5-col` on desktop) and live terminal log viewer. |
| [src/components/features/edge-pwa/mobile-edge-simulator.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/components/features/edge-pwa/mobile-edge-simulator.tsx) | Interactive browser preview of route-filtered mobile alerts, OSRM corridor matching, and veracity meters. |
| [src/app/download/page.tsx](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/app/download/page.tsx) | Direct Android `.apk` download page serving `public/downloads/bigwarn-edge.apk` with installation steps. |
| [src/app/api/bigwarn/[...slug]/route.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/app/api/bigwarn/%5B...slug%5D/route.ts) | Server-side Next.js API proxy that forwards browser requests to `BIGWARN_FEED_URL` with `Authorization: Bearer <BIGWARN_FEED_TOKEN>` so secrets are never exposed to the client. |
| [src/lib/server-stream.ts](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/src/lib/server-stream.ts) | Server-side fallback reader and strict `AREA_METADATA` place validator. |

---

## 2. Responsive Mobile & Desktop Design Features

1. **Fixed Bottom Thumb-Navigation Bar (`sm:hidden`)**:
   - On mobile phones, a floating frosted-glass bottom navigation bar allows one-handed switching between **Stream**, **Lakehouse**, **Edge Map**, **45 Portals**, and **Get APK**.
2. **Collapsible Mobile Search & Filter Drawer**:
   - Filters (Event Type, Area, Language, Portal, Sort order) collapse behind a compact **Filters** toggle button with an active filter badge on mobile screens.
3. **Dual Mobile Card + Desktop Table Rendering**:
   - Both the Live Stream view and the Silver Medallion table automatically switch from wide HTML tables (`hidden md:block`) to touch-friendly cards (`md:hidden`) on mobile viewports.

---

## 3. Environment Configuration & Running Locally

Create or update [frontend/.env.local](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/.env.local):

```env
BIGWARN_FEED_URL=https://your-active-tunnel.trycloudflare.com
BIGWARN_FEED_TOKEN=your-feed-token
```

Run the development server or verify the production build:

```bash
cd /Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend
npm install
npm run dev

# Type-check & production build
./node_modules/.bin/tsc --noEmit
npm run build
```

---

## 4. Deploying to Vercel

1. Import `real-time-alert/frontend` as the root directory in Vercel.
2. In **Vercel Project Settings → Environment Variables**, set:
   - `BIGWARN_FEED_URL` = your active `https://*.trycloudflare.com` tunnel URL
   - `BIGWARN_FEED_TOKEN` = your `BIGWARN_FEED_TOKEN`
3. Whenever you rebuild the Android APK via `mobile/build_apk.sh`, it copies the new APK to `frontend/public/downloads/bigwarn-edge.apk` so your Vercel `/download` page serves the latest build.
