"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A notice that a search param asks for (`?existant=1`) and that must not come back with a reload: the page renders
 * `children` (the notice, written server side) when the param is there and passes `active`; this leaf keeps showing
 * them for as long as it stays mounted and, once after mount, replaces the URL with the same one minus the param
 * (`scroll: false`, no history entry). The server then renders without the param, which a notice kept in state
 * survives; a reload or another visit starts without it.
 */
export function OneTimeNotice({
  param,
  active,
  children,
}: {
  param: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shown] = useState(active);

  useEffect(() => {
    if (!active) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(param);
    const query = rest.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  }, [active, param, pathname, router, searchParams]);

  return shown ? children : null;
}
