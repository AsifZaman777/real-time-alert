import React from "react";
import { PublicAppPortal } from "@/components/features/auth/public-app-portal";
import {
  getAdminSessionFromCookies,
  isAdminAuthConfigured,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function DownloadAppPage() {
  const session = getAdminSessionFromCookies();
  return (
    <PublicAppPortal
      authConfigured={isAdminAuthConfigured()}
      isAuthenticated={Boolean(session)}
      adminId={session?.adminId || null}
    />
  );
}
