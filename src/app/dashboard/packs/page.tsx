import { redirect } from "next/navigation";

import { requireProContext } from "@/server/pro-context";

export default async function Page() {
  await requireProContext();
  redirect("/dashboard/tickets");
}
