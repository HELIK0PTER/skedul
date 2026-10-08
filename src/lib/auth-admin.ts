import { admin } from "better-auth/plugins";

/**
 * Roles, suspension, impersonation. defaultRole must be a user_role enum
 * value — the plugin's own default ("user") would violate the enum.
 * Kept in its own module (no env, no db) so a test can inspect the plugin.
 */
export const adminPlugin = admin({
  defaultRole: "client",
  adminRoles: ["admin"],
  bannedUserMessage:
    "Votre compte a été suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
});

/**
 * Every HTTP endpoint the admin plugin registers (/api/auth/admin/*), fed to
 * `disabledPaths`. They are authorised from the 5-minute cookie-cached role and
 * would bypass the stricter, DB-fresh checks of the server actions in
 * src/server/admin.ts (which also expose no delete or set-password), so none is
 * served over HTTP. Derived from the plugin itself so that an upgrade adding an
 * endpoint is closed automatically. This only affects the HTTP router;
 * in-process `auth.api.*` calls keep working.
 */
export const ADMIN_HTTP_ENDPOINTS: string[] = Object.values(
  adminPlugin.endpoints,
).map((endpoint) => endpoint.path);
