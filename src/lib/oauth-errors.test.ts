import test from "node:test";
import assert from "node:assert/strict";

import { oauthErrorMessage } from "./oauth-errors";

test("no error code gives no message", () => {
  assert.equal(oauthErrorMessage(undefined), null);
  assert.equal(oauthErrorMessage(null), null);
  assert.equal(oauthErrorMessage(""), null);
});

test("known Better Auth codes get a specific message", () => {
  assert.match(oauthErrorMessage("access_denied")!, /annulée/);
  assert.match(oauthErrorMessage("account_not_linked")!, /mot de passe/);
  assert.match(oauthErrorMessage("BANNED_USER")!, /suspendu/);
});

test("unknown codes fall back to a generic message", () => {
  assert.equal(
    oauthErrorMessage("invalid_code"),
    "La connexion avec Google a échoué. Réessayez.",
  );
});
