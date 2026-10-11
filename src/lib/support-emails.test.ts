import test from "node:test";
import assert from "node:assert/strict";

import {
  supportAdminReplyEmail,
  supportNewRequestEmail,
  supportResolutionEmail,
  supportStageEmail,
  supportUserReplyEmail,
} from "./support-emails";

test("support e-mails escape user content", () => {
  const mail = supportNewRequestEmail({
    number: 7,
    subject: "<b>Hi</b>",
    type: "bug",
    authorName: "Ana <x>",
    authorEmail: "ana@example.com",
    body: "<script>alert(1)</script>\nligne 2",
    url: "https://myskedul.com/admin/support/r1",
  });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("&lt;b&gt;Hi&lt;/b&gt;"));
  assert.ok(mail.html.includes("Ana &lt;x&gt;"));
  assert.ok(mail.html.includes("<br>ligne 2"));
  assert.equal(mail.subject, "Nouvelle demande #7 : <b>Hi</b>");
});

test("the stage e-mail spells out the step and the estimate", () => {
  const mail = supportStageEmail({
    name: "Ana Souza",
    number: 42,
    subject: "Export CSV",
    track: "development",
    stage: "in_development",
    eta: "2026-10-31",
    url: "https://myskedul.com/aide/demandes/r1",
  });
  assert.equal(mail.subject, "Votre demande #42 : En développement");
  assert.ok(mail.html.includes("Étape 4 sur 6 : En développement"));
  assert.ok(mail.html.includes("31 octobre"));
  assert.ok(mail.html.includes("Bonjour Ana,"));
});

test("the resolution e-mail carries the reason, or announces a reopening", () => {
  const declined = supportResolutionEmail({
    name: "Ana",
    number: 3,
    subject: "Mode sombre",
    resolution: "declined",
    reason: "Pas prévu cette année.",
    url: "u",
  });
  assert.equal(declined.subject, "Votre demande #3 : Non retenue");
  assert.ok(declined.html.includes("Pas prévu cette année."));
  const reopened = supportResolutionEmail({
    name: "Ana",
    number: 3,
    subject: "Mode sombre",
    resolution: null,
    reason: "",
    url: "u",
  });
  assert.equal(reopened.subject, "Votre demande #3 : Rouverte");
});

test("reply e-mails quote the message", () => {
  const toAdmin = supportUserReplyEmail({ number: 5, subject: "Bug", authorName: "Léo", body: "Merci !", url: "u" });
  assert.equal(toAdmin.subject, "Nouvelle réponse sur #5 : Bug");
  assert.ok(toAdmin.html.includes("Merci !"));
  const toUser = supportAdminReplyEmail({ name: "Léo Martin", number: 5, subject: "Bug", body: "C’est corrigé.", url: "u" });
  assert.equal(toUser.subject, "Votre demande #5 : nouvelle réponse");
  assert.ok(toUser.html.includes("C’est corrigé."));
});
