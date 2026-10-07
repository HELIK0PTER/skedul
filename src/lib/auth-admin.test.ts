import test from "node:test";
import assert from "node:assert/strict";

import { ADMIN_HTTP_ENDPOINTS, adminPlugin } from "./auth-admin";

test("every endpoint of the admin plugin is closed over HTTP", () => {
  assert.equal(
    ADMIN_HTTP_ENDPOINTS.length,
    Object.keys(adminPlugin.endpoints).length,
  );
  // 15 endpoints in better-auth 1.6; an upgrade may add some, never remove them.
  assert.ok(ADMIN_HTTP_ENDPOINTS.length >= 15, String(ADMIN_HTTP_ENDPOINTS.length));
  for (const path of ADMIN_HTTP_ENDPOINTS) {
    assert.ok(path.startsWith("/admin/"), path);
  }
});

test("the dangerous admin endpoints are among the closed ones", () => {
  for (const path of [
    "/admin/remove-user",
    "/admin/set-user-password",
    "/admin/set-role",
    "/admin/impersonate-user",
    "/admin/ban-user",
    "/admin/list-users",
  ]) {
    assert.ok(ADMIN_HTTP_ENDPOINTS.includes(path), path);
  }
});
