import type { Metadata } from "next";

import { ExpiredLink, ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// The URL carries the reset token: never leak it through the Referer header.
export const metadata: Metadata = {
  title: "Nouveau mot de passe",
  referrer: "no-referrer",
};

/**
 * Landing page of the emailed link. Better Auth's /api/auth/reset-password/:token
 * checks the token, then redirects here with ?token=… or ?error=INVALID_TOKEN.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && !error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {valid ? "Nouveau mot de passe" : "Lien expiré"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {valid ? <ResetPasswordForm token={token} /> : <ExpiredLink />}
      </CardContent>
    </Card>
  );
}
