import { Construction } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/** Temporary stand-in for pages rebuilt by the tickets & événements plans (P3–P5). */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Construction className="size-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
