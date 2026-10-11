import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { FaqEditor } from "@/components/admin/support-faq-editor";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/admin";
import { getFaqForAdmin } from "@/server/support-queries";

export const metadata: Metadata = { title: "FAQ" };

export default async function AdminFaqPage() {
  await requireAdmin();
  const categories = await getFaqForAdmin();
  return (
    <>
      <PageHeader
        title="Support"
        description="La FAQ publique du centre d’aide."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/aide" target="_blank">
              <ExternalLink />
              Voir le centre d’aide
            </Link>
          </Button>
        }
      />
      <SupportTabs active="faq" />
      <FaqEditor categories={categories} />
    </>
  );
}
