import { redirect } from "next/navigation";

type Params = { params: Promise<{ slug: string; eventTypeId: string }> };

/** The old booking flow is gone; P4 rebuilds booking on séances. */
export default async function BookEventPage({ params }: Params) {
  const { slug } = await params;
  redirect(`/${encodeURIComponent(slug)}`);
}
