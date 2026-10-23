import { permanentRedirect } from "next/navigation";

type Params = { params: Promise<{ slug: string; packId: string }> };

/** Packs became ticket offers sold in the Boutique: the old URL moved for good to the public page (308, OUT:96). */
export default async function BuyPackPage({ params }: Params) {
  const { slug } = await params;
  permanentRedirect(`/${encodeURIComponent(slug)}`);
}
