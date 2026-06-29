"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateSessionCapacity } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SessionCapacityControl({
  sessionId,
  capacity,
}: {
  sessionId: string;
  capacity: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(capacity));
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const next = parseInt(value, 10);
    if (isNaN(next) || next < 1) return;
    startTransition(async () => {
      await updateSessionCapacity({ sessionId, capacity: next });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-20 text-sm"
        disabled={pending}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={handleSave}
        disabled={pending || parseInt(value, 10) === capacity}
      >
        {pending ? "…" : "OK"}
      </Button>
    </div>
  );
}
