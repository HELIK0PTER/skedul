import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_EXISTS,
  ACCOUNT_SUSPENDED,
  authFormErrorMessage,
  CODE_SENT,
  GENERIC_ERROR,
  NAME_NOT_PLAIN_CODE,
  RATE_LIMITED,
  SEND_FAILED,
  sendCodeFailure,
  TOO_MANY_ATTEMPTS,
  VERIFY_FAILED,
  verifyCodeFailure,
  WRONG_CODE,
  WRONG_CREDENTIALS,
} from "./auth-messages";
import { oauthErrorMessage } from "./oauth-errors";
import { COPY } from "./public/messages";

test("a rate-limited answer is the French sentence, whatever its code", () => {
  assert.equal(authFormErrorMessage({ status: 429 }), RATE_LIMITED);
  assert.equal(authFormErrorMessage({ status: 429, code: "INVALID_EMAIL_OR_PASSWORD" }), RATE_LIMITED);
  assert.equal(sendCodeFailure({ status: 429 }), RATE_LIMITED);
  assert.equal(verifyCodeFailure({ status: 429 }), RATE_LIMITED);
});

test("sign-in and sign-up: an existing address, a wrong password, a banned account", () => {
  assert.equal(authFormErrorMessage({ status: 422, code: "USER_ALREADY_EXISTS" }), ACCOUNT_EXISTS);
  assert.equal(authFormErrorMessage({ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }), ACCOUNT_EXISTS);
  assert.equal(authFormErrorMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }), WRONG_CREDENTIALS);
  assert.equal(authFormErrorMessage({ status: 403, code: "BANNED_USER" }), oauthErrorMessage("BANNED_USER"));
  assert.equal(WRONG_CREDENTIALS, "Email ou mot de passe incorrect.");
  assert.match(ACCOUNT_EXISTS, /^Un compte existe déjà avec cet email\. Connectez-vous ou réinitialisez votre mot de passe\.$/);
});

test("sign-in and sign-up: anything else is the generic sentence, never the English message", () => {
  assert.equal(authFormErrorMessage({ status: 400, code: "SOMETHING_NEW" }), GENERIC_ERROR);
  assert.equal(authFormErrorMessage({ status: 500 }), GENERIC_ERROR);
  assert.equal(authFormErrorMessage(null), GENERIC_ERROR);
  assert.equal(authFormErrorMessage(undefined), GENERIC_ERROR);
  const withEnglish = { status: 400, code: "INVALID_EMAIL", message: "Invalid email" };
  assert.equal(authFormErrorMessage(withEnglish), GENERIC_ERROR);
  assert.equal(GENERIC_ERROR, "Une erreur est survenue.");
});

test("sending a code: only a server failure differs from the neutral answer", () => {
  assert.equal(sendCodeFailure({ status: 500 }), SEND_FAILED);
  assert.equal(sendCodeFailure({ status: 503 }), SEND_FAILED);
  // The address is the user's own and the endpoint never says whether it exists: any other answer keeps the neutral sentence.
  assert.equal(sendCodeFailure({ status: 400, code: "USER_NOT_FOUND" }), null);
  assert.equal(sendCodeFailure({ status: 403 }), null);
  assert.equal(sendCodeFailure(null), null);
  assert.equal(sendCodeFailure(undefined), null);
});

test("checking a code: wrong or expired, burnt after 3 attempts, server failure", () => {
  // Better Auth answers 400 INVALID_OTP / OTP_EXPIRED, then 403 TOO_MANY_ATTEMPTS once the 3 attempts are used.
  assert.equal(verifyCodeFailure({ status: 400, code: "INVALID_OTP" }), WRONG_CODE);
  assert.equal(verifyCodeFailure({ status: 400, code: "OTP_EXPIRED" }), WRONG_CODE);
  assert.equal(verifyCodeFailure({ status: 403, code: "TOO_MANY_ATTEMPTS" }), TOO_MANY_ATTEMPTS);
  assert.equal(verifyCodeFailure({ code: "TOO_MANY_ATTEMPTS" }), TOO_MANY_ATTEMPTS);
  assert.equal(verifyCodeFailure({ status: 500 }), VERIFY_FAILED);
  assert.equal(verifyCodeFailure({ status: 502, code: "INVALID_OTP" }), VERIFY_FAILED);
  assert.equal(verifyCodeFailure(undefined), WRONG_CODE);
  assert.equal(TOO_MANY_ATTEMPTS, "Trop d'essais. Demandez un nouveau code.");
});

test("every sentence ends with a full stop and carries no em or en dash", () => {
  const all = [
    RATE_LIMITED,
    ACCOUNT_EXISTS,
    WRONG_CREDENTIALS,
    GENERIC_ERROR,
    SEND_FAILED,
    VERIFY_FAILED,
    WRONG_CODE,
    TOO_MANY_ATTEMPTS,
    CODE_SENT,
    ACCOUNT_SUSPENDED,
  ];
  // Code points, not the characters: the source stays free of the dashes it forbids.
  const dashes = [0x2013, 0x2014].map((code) => String.fromCharCode(code));
  for (const sentence of all) {
    for (const dash of dashes) assert.ok(!sentence.includes(dash), sentence);
    assert.ok(sentence.endsWith("."), sentence);
  }
});

test("the neutral code-sent sentence and the suspended-account sentence are the exact ones (L1247)", () => {
  assert.equal(CODE_SENT, "Si l'adresse est valide, un code a été envoyé.");
  assert.equal(ACCOUNT_SUSPENDED, oauthErrorMessage("BANNED_USER"));
  assert.equal(ACCOUNT_SUSPENDED, "Ce compte est suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.");
});

test("checking a code: a suspended account reads the suspension sentence, not « code incorrect » (H2)", () => {
  assert.equal(verifyCodeFailure({ status: 403, code: "BANNED_USER" }), ACCOUNT_SUSPENDED);
  assert.equal(verifyCodeFailure({ code: "BANNED_USER" }), ACCOUNT_SUSPENDED);
  // A rate limit and a server failure still win, and any other code is still « incorrect ou expiré ».
  assert.equal(verifyCodeFailure({ status: 429, code: "BANNED_USER" }), RATE_LIMITED);
  assert.equal(verifyCodeFailure({ status: 500, code: "BANNED_USER" }), VERIFY_FAILED);
  assert.equal(verifyCodeFailure({ status: 403, code: "SOMETHING_ELSE" }), WRONG_CODE);
});

test("checking a code: a name the server refuses reads the plain-name sentence, never « code incorrect » (P6 A9)", () => {
  assert.equal(NAME_NOT_PLAIN_CODE, "NAME_NOT_PLAIN");
  assert.equal(verifyCodeFailure({ status: 400, code: NAME_NOT_PLAIN_CODE }), COPY.PLAIN_NAME);
  assert.equal(verifyCodeFailure({ status: 429, code: NAME_NOT_PLAIN_CODE }), RATE_LIMITED);
  assert.equal(verifyCodeFailure({ status: 500, code: NAME_NOT_PLAIN_CODE }), VERIFY_FAILED);
});

test("sending a code: a 200 and a 400 answer keep the neutral sentence, so the answer never depends on the address (S22)", () => {
  assert.equal(sendCodeFailure({ status: 200 }), null);
  assert.equal(sendCodeFailure({ status: 400 }), null);
  assert.equal(sendCodeFailure({ status: 400, code: "INVALID_EMAIL" }), null);
  assert.equal(sendCodeFailure({ status: 429 }), RATE_LIMITED);
  assert.equal(sendCodeFailure({ status: 500 }), SEND_FAILED);
});
