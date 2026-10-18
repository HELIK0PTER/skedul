import { redirect } from "next/navigation";

type Params = { params: Promise<{ slug: string; packId: string }> };

/** Packs became ticket offers; P4 rebuilds the offer page. */
export default async function BuyPackPage({ params }: Params) {
  const { slug } = await params;
  redirect(`/${encodeURIComponent(slug)}`);
}
