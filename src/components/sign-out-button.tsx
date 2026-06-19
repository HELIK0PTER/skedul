"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { signOut } from "@/lib/auth-client";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  withLabel = true,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  withLabel?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant={variant}
      size={size}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut className="size-4" />
      {withLabel && "Se déconnecter"}
    </Button>
  );
}
