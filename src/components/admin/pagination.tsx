import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={hrefFor(page - 1)}>
            <ChevronLeft />
            Précédent
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} sur {pageCount}
      </span>
      {page < pageCount ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={hrefFor(page + 1)}>
            Suivant
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
