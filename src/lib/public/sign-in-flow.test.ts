import assert from "node:assert/strict";
import test from "node:test";

import type { VisitorState } from "./identity";
import {
  CODE_LENGTH,
  authFormGoogleCallbacks,
  canOfferCodeSignIn,
  codeInputValue,
  focusTargetOnClose,
  googleCallbacks,
  isCompleteCode,
  linkGoogleCallbacks,
  linkGoogleHref,
  linkReturnPath,
  nameToSend,
  passwordSignInHref,
  returnPathOf,
} from "./sign-in-flow";

test("codeInputValue keeps the digits only, at most six", () => {
  assert.equal(CODE_LENGTH, 6);
  assert.equal(codeInputValue("12 a3-456789"), "123456");
  assert.equal(codeInputValue("123 456"), "123456");
  assert.equal(codeInputValue("42"), "42");
  assert.equal(codeInputValue("abc"), "");
  assert.equal(codeInputValue(""), "");
});

test("isCompleteCode is true for exactly six digits", () => {
  assert.equal(isCompleteCode("123456"), true);
  assert.equal(isCompleteCode("000000"), true);
  for (const bad of ["", "12345", "1234567", "12345a", "12 456", " 23456"]) assert.equal(isCompleteCode(bad), false, bad);
});

test("returnPathOf keeps a plain path of the site and drops its query and hash (SEC-M7)", () => {
  assert.equal(returnPathOf("/altinha-paris"), "/altinha-paris");
  assert.equal(returnPathOf("/altinha-paris/seance/x"), "/altinha-paris/seance/x");
  assert.equal(returnPathOf("/mon-espace"), "/mon-espace");
  assert.equal(returnPathOf("/altinha-paris/seance/x?paiement=annule&p=y#z"), "/altinha-paris/seance/x");
  assert.equal(returnPathOf("/a?x=1"), "/a");
  assert.equal(returnPathOf("/a#top"), "/a");
});

test("returnPathOf sends anything that could leave the site, or is not a path, to /mon-espace (SEC-M7)", () => {
  for (const bad of [
    "//evil.example",
    "https://evil.example",
    "/\\evil",
    "/\\\\evil.example",
    "javascript:alert(1)",
    "",
    "mon-espace",
    "/\u0000x",
    "/.//evil.example",
  ]) {
    assert.equal(returnPathOf(bad), "/mon-espace", bad);
  }
});

test("googleCallbacks returns to the page and sends a failure through /sign-in?next= (L76)", () => {
  assert.deepEqual(googleCallbacks("/altinha-paris/seance/x"), {
    callbackURL: "/altinha-paris/seance/x",
    newUserCallbackURL: "/altinha-paris/seance/x",
    errorCallbackURL: "/sign-in?next=%2Faltinha-paris%2Fseance%2Fx",
  });
  // A client who signs up with Google comes back to the page, never to the pro onboarding.
  assert.ok(!Object.values(googleCallbacks("/altinha-paris")).some((url) => url.includes("onboarding")));
});

test("googleCallbacks drops a query and refuses a foreign target, whatever the caller passes (SEC-M7)", () => {
  assert.deepEqual(googleCallbacks("/altinha-paris/seance/x?paiement=annule&p=secret#z"), googleCallbacks("/altinha-paris/seance/x"));
  assert.deepEqual(googleCallbacks("//evil.example"), {
    callbackURL: "/mon-espace",
    newUserCallbackURL: "/mon-espace",
    errorCallbackURL: "/sign-in?next=%2Fmon-espace",
  });
  for (const url of Object.values(googleCallbacks("/a?p=secret"))) assert.ok(!url.includes("secret"), url);
});

test("authFormGoogleCallbacks: sign-in mode never lands on /onboarding, with or without next (COV-I3)", () => {
  assert.deepEqual(authFormGoogleCallbacks("sign-in", null), {
    callbackURL: "/sign-in",
    newUserCallbackURL: "/sign-in",
    errorCallbackURL: "/sign-in",
  });
  assert.deepEqual(authFormGoogleCallbacks("sign-in", "/aide/demandes"), {
    callbackURL: "/sign-in?next=%2Faide%2Fdemandes",
    newUserCallbackURL: "/sign-in?next=%2Faide%2Fdemandes",
    errorCallbackURL: "/sign-in?next=%2Faide%2Fdemandes",
  });
  for (const next of [null, "/aide/demandes"]) {
    const urls = Object.values(authFormGoogleCallbacks("sign-in", next));
    assert.ok(!urls.some((url) => url.includes("onboarding")), String(next));
  }
});

test("authFormGoogleCallbacks: sign-up mode sends a new user to next, else to the pro onboarding (L1397)", () => {
  assert.deepEqual(authFormGoogleCallbacks("sign-up", null), {
    callbackURL: "/sign-in",
    newUserCallbackURL: "/onboarding",
    errorCallbackURL: "/sign-up",
  });
  assert.deepEqual(authFormGoogleCallbacks("sign-up", "/aide/demandes"), {
    callbackURL: "/sign-in?next=%2Faide%2Fdemandes",
    newUserCallbackURL: "/aide/demandes",
    errorCallbackURL: "/sign-up?next=%2Faide%2Fdemandes",
  });
});

test("authFormGoogleCallbacks ignores a next that is not a plain path of the site", () => {
  for (const mode of ["sign-in", "sign-up"] as const) {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", ""]) {
      assert.deepEqual(authFormGoogleCallbacks(mode, bad), authFormGoogleCallbacks(mode, null), `${mode} ${bad}`);
    }
  }
});

test("passwordSignInHref points at /sign-in with the page to come back to, query dropped", () => {
  assert.equal(passwordSignInHref("/altinha-paris"), "/sign-in?next=%2Faltinha-paris");
  assert.equal(passwordSignInHref("/altinha-paris/espace?lien=invalide"), "/sign-in?next=%2Faltinha-paris%2Fespace");
  assert.equal(passwordSignInHref("//evil.example"), "/sign-in?next=%2Fmon-espace");
});

test("linkReturnPath keeps the path of a plain site path, query and hash dropped, and nothing else (AUTH-2, SEC-M7)", () => {
  assert.equal(linkReturnPath("/altinha-paris/seance/occ_1"), "/altinha-paris/seance/occ_1");
  assert.equal(linkReturnPath("/altinha-paris/seance/occ_1?p=ref_1&paiement=annule"), "/altinha-paris/seance/occ_1", "a `p` never travels");
  assert.equal(linkReturnPath("/altinha-paris#boutique"), "/altinha-paris");
  assert.equal(linkReturnPath("/"), "/");
  for (const bad of [null, undefined, "", "altinha-paris", "//evil.example", "https://evil.example", "/\\evil", "/.//evil.example", "/x\ny", ["/a"], 42]) {
    assert.equal(linkReturnPath(bad), null, String(bad));
  }
});

test("linkGoogleHref sends an account_not_linked answer to /link-google, with the page to come back to when there is one (AUTH-2)", () => {
  assert.equal(linkGoogleHref("/altinha-paris/seance/occ_1"), "/link-google?next=%2Faltinha-paris%2Fseance%2Focc_1");
  assert.equal(linkGoogleHref("/altinha-paris/espace?p=ref_1"), "/link-google?next=%2Faltinha-paris%2Fespace");
  assert.equal(linkGoogleHref(undefined), "/link-google", "no next: /sign-in routes as usual afterwards");
  assert.equal(linkGoogleHref("//evil.example"), "/link-google");
  assert.equal(linkGoogleHref(["/a", "/b"]), "/link-google", "a repeated parameter is no path");
});

test("linkGoogleCallbacks comes back through /sign-in with the same next, and shows a failure on the link page, which keeps it (AUTH-2)", () => {
  assert.deepEqual(linkGoogleCallbacks("/altinha-paris/seance/occ_1"), {
    callbackURL: "/sign-in?next=%2Faltinha-paris%2Fseance%2Focc_1",
    errorCallbackURL: "/link-google?next=%2Faltinha-paris%2Fseance%2Focc_1",
  });
  assert.deepEqual(linkGoogleCallbacks(null), { callbackURL: "/sign-in", errorCallbackURL: "/link-google" });
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil", ""]) {
    assert.deepEqual(linkGoogleCallbacks(bad), linkGoogleCallbacks(null), bad);
  }
  assert.deepEqual(linkGoogleCallbacks("/mon-espace?p=ref_1#x"), linkGoogleCallbacks("/mon-espace"), "query and hash dropped");
});

test("nameToSend sends a trimmed plain name of at most 80 characters, else nothing (L1249)", () => {
  assert.equal(nameToSend("Léa Martin"), "Léa Martin");
  assert.equal(nameToSend("  Léa Martin  "), "Léa Martin");
  assert.equal(nameToSend(""), undefined);
  assert.equal(nameToSend("     "), undefined);
  assert.equal(nameToSend("x".repeat(100)), "x".repeat(80));
  // The cut falls on a space: it is trimmed, not sent.
  assert.equal(nameToSend(`${"x".repeat(79)} ${"y".repeat(10)}`), "x".repeat(79));
  // The cut falls inside a surrogate pair: half an emoji is never sent.
  assert.equal(nameToSend(`${"a".repeat(79)}\u{1F600}`), "a".repeat(79));
});

test("nameToSend refuses a name with a link, an address or a long digit run (SEC-M9)", () => {
  for (const refused of ["www.x.fr", "voir http://x.fr", "lea@example.com", "Léa 0612345678", "Léa 06 12 34 56 78", "bit.ly/x"]) {
    assert.equal(nameToSend(refused), undefined, refused);
  }
});

test("canOfferCodeSignIn is true for an anonymous visitor only (risk 7, COV-C1)", () => {
  const states: VisitorState[] = ["anonymous", "unverified", "verified", "impersonating"];
  assert.deepEqual(
    states.filter((state) => canOfferCodeSignIn(state)),
    ["anonymous"],
  );
});

test("focusTargetOnClose names the caller's target after a sign-in only; a dialog closed without one gives the focus back to its opener", () => {
  const target = { name: "planning heading" };
  let asked = 0;
  const ask = () => {
    asked += 1;
    return target;
  };
  assert.equal(focusTargetOnClose(true, ask), target);
  assert.equal(asked, 1);
  // Escape, « Fermer » or a click outside: no target (the dialog then restores its opener), and the caller is not even asked.
  assert.equal(focusTargetOnClose(false, ask), null);
  assert.equal(asked, 1);
  // Signed in with no target given, or a target that is gone: nothing to name.
  assert.equal(focusTargetOnClose(true, undefined), null);
  assert.equal(focusTargetOnClose(true, () => null), null);
  assert.equal(focusTargetOnClose(false, undefined), null);
});
