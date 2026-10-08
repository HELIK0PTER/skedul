import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdmin } from "@/lib/admin";
import { ENTRY_COOKIE, parseEntryChoice } from "@/lib/entry";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Skedul" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  const remembered = parseEntryChoice((await cookies()).get(ENTRY_COOKIE)?.value);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar adminName={admin.name} remembered={remembered} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>
      </main>
    </div>
  );
}
