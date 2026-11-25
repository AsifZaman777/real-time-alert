import React from "react";
import { AdminDashboard } from "@/components/features/admin/admin-dashboard";
import { PublicAppPortal } from "@/components/features/auth/public-app-portal";
import {
  getAdminSessionFromCookies,
  isAdminAuthConfigured,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const session = getAdminSessionFromCookies();
  const configured = isAdminAuthConfigured();

  if (!session) {
    return (
      <PublicAppPortal
        authConfigured={configured}
        isAuthenticated={false}
      />
    );
  }

  return <AdminDashboard adminId={session.adminId} />;
}
