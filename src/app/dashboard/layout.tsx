import { redirect } from "next/navigation";

import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { brandThemeVars } from "@/lib/color";
import { getCurrentProfessional, getSession } from "@/lib/session";
import { hasUnreadSupport } from "@/server/support-queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const pro = await getCurrentProfessional();
  if (!pro) redirect("/onboarding");

  const supportUnread = await hasUnreadSupport(session.user.id);

  return (
    <>
      {session.session.impersonatedBy && (
        <ImpersonationBanner name={session.user.name} email={session.user.email} />
      )}
      <div
        className="flex min-h-screen flex-col md:flex-row"
        style={brandThemeVars(pro.brandColor)}
      >
        <DashboardSidebar
          businessName={pro.businessName}
          slug={pro.slug}
          // UI hint only — /admin re-checks the role in the database.
          isAdmin={session.user.role === "admin"}
          supportUnread={supportUnread}
        />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
        </main>
      </div>
    </>
  );
}
