import { permanentRedirect } from "next/navigation";

type Params = { params: Promise<{ slug: string; eventTypeId: string }> };

/** The old booking flow became séances: its URL moved for good to the public page (308, OUT:96). */
export default async function BookEventPage({ params }: Params) {
  const { slug } = await params;
  permanentRedirect(`/${encodeURIComponent(slug)}`);
}
