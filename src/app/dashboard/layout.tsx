import { redirect } from "next/navigation";

import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { brandThemeVars } from "@/lib/color";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const pro = await getCurrentProfessional();
  if (!pro) redirect("/onboarding");

  return (
    <div
      className="flex min-h-screen flex-col md:flex-row"
      style={brandThemeVars(pro.brandColor)}
    >
      <DashboardSidebar businessName={pro.businessName} slug={pro.slug} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
      </main>
    </div>
  );
}
