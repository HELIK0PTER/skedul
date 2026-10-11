import test from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_STEPS,
  canAcceptForDevelopment,
  canSetStage,
  canUserReply,
  checkAttachments,
  formatEta,
  isOpen,
  isValidEta,
  matchArticles,
  moveInList,
  normalizeSearch,
  parseAnswer,
  parseInboxFilter,
  parseSupportType,
  progressRatio,
  stageAfterAdminReply,
  stageAfterUserReply,
  stageReachedAt,
  statusLabel,
  stepCount,
  stepIndex,
  type RequestState,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
} from "./support";

const req = (
  track: SupportTrack,
  stage: SupportStage,
  resolution: SupportResolution | null = null,
): RequestState => ({ track, stage, resolution });

test("each track lists its steps in order", () => {
  assert.deepEqual(TRACK_STEPS.support, ["received", "in_progress", "resolved"]);
  assert.deepEqual(TRACK_STEPS.development, [
    "received",
    "accepted",
    "planned",
    "in_development",
    "testing",
    "delivered",
  ]);
});

test("stepIndex and progressRatio place a stage on its track", () => {
  assert.equal(stepIndex("development", "in_development"), 3);
  assert.equal(stepCount("development"), 6);
  assert.equal(stepCount("support"), 3);
  assert.equal(progressRatio("development", "in_development"), 0.6);
  assert.equal(progressRatio("support", "received"), 0);
  assert.equal(progressRatio("support", "resolved"), 1);
});

test("canSetStage only accepts steps of the current track", () => {
  assert.equal(canSetStage("development", "testing"), true);
  assert.equal(canSetStage("development", "accepted"), true);
  assert.equal(canSetStage("support", "received"), true);
  assert.equal(canSetStage("development", "in_progress"), false);
  assert.equal(canSetStage("support", "planned"), false);
});

test("a development request never goes back to received", () => {
  // the kanban has no "Reçue" column: accepted is the floor of that track
  assert.equal(canSetStage("development", "received"), false);
});

test("moveInList swaps an id with its neighbour", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], "b", "down"), ["a", "c", "b"]);
  assert.equal(moveInList(["a", "b", "c"], "a", "up"), null);
  assert.equal(moveInList(["a", "b", "c"], "c", "down"), null);
  assert.equal(moveInList(["a", "b", "c"], "x", "up"), null);
});

test("isOpen is false once resolved, delivered, declined or closed", () => {
  assert.equal(isOpen(req("support", "in_progress")), true);
  assert.equal(isOpen(req("development", "testing")), true);
  assert.equal(isOpen(req("support", "resolved")), false);
  assert.equal(isOpen(req("development", "delivered")), false);
  assert.equal(isOpen(req("development", "testing", "declined")), false);
  assert.equal(isOpen(req("support", "received", "closed")), false);
});

test("statusLabel prefers the resolution over the stage", () => {
  assert.equal(statusLabel(req("development", "planned")), "Planifiée");
  assert.equal(statusLabel(req("development", "planned", "declined")), "Non retenue");
  assert.equal(statusLabel(req("support", "received", "closed")), "Fermée");
});

test("canAcceptForDevelopment needs a live support request", () => {
  assert.equal(canAcceptForDevelopment(req("support", "received")), true);
  assert.equal(canAcceptForDevelopment(req("support", "in_progress")), true);
  assert.equal(canAcceptForDevelopment(req("support", "resolved")), false);
  assert.equal(canAcceptForDevelopment(req("support", "in_progress", "declined")), false);
  assert.equal(canAcceptForDevelopment(req("development", "accepted")), false);
});

test("canUserReply is false only on a closed request", () => {
  assert.equal(canUserReply(req("support", "resolved")), true);
  assert.equal(canUserReply(req("development", "testing", "declined")), true);
  assert.equal(canUserReply(req("support", "in_progress", "closed")), false);
});

test("a user reply reopens a resolved support request only", () => {
  assert.equal(stageAfterUserReply(req("support", "resolved")), "in_progress");
  assert.equal(stageAfterUserReply(req("support", "received")), "received");
  assert.equal(stageAfterUserReply(req("development", "delivered")), "delivered");
  assert.equal(stageAfterUserReply(req("support", "resolved", "declined")), "resolved");
});

test("the first admin reply moves a received support request forward", () => {
  assert.equal(stageAfterAdminReply(req("support", "received")), "in_progress");
  assert.equal(stageAfterAdminReply(req("support", "resolved")), "resolved");
  assert.equal(stageAfterAdminReply(req("development", "accepted")), "accepted");
  assert.equal(stageAfterAdminReply(req("support", "received", "closed")), "received");
});

test("stageReachedAt keeps the latest time each step was entered", () => {
  const created = new Date("2026-10-01T10:00:00Z");
  const day = (d: number) => new Date(`2026-10-0${d}T10:00:00Z`);
  const reached = stageReachedAt(created, [
    { kind: "message", stage: null, createdAt: day(2) },
    { kind: "stage_change", stage: "accepted", createdAt: day(3) },
    { kind: "stage_change", stage: "testing", createdAt: day(4) },
    { kind: "stage_change", stage: "in_development", createdAt: day(5) },
    { kind: "stage_change", stage: "testing", createdAt: day(6) },
  ]);
  assert.equal(reached.received?.toISOString(), created.toISOString());
  assert.equal(reached.accepted?.toISOString(), day(3).toISOString());
  assert.equal(reached.in_development?.toISOString(), day(5).toISOString());
  assert.equal(reached.testing?.toISOString(), day(6).toISOString());
  assert.equal(reached.planned, undefined);
});

test("parseInboxFilter defaults to todo", () => {
  assert.equal(parseInboxFilter(undefined), "todo");
  assert.equal(parseInboxFilter("nope"), "todo");
  assert.equal(parseInboxFilter("done"), "done");
});

test("parseSupportType accepts known types only", () => {
  assert.equal(parseSupportType("bug"), "bug");
  assert.equal(parseSupportType("BUG"), null);
  assert.equal(parseSupportType(undefined), null);
});

test("checkAttachments enforces count, type and size", () => {
  const png = { type: "image/png", size: 1000 };
  assert.deepEqual(checkAttachments([png, png, png]), { ok: true });
  assert.equal(checkAttachments([png, png, png, png]).ok, false);
  assert.equal(checkAttachments([{ type: "image/gif", size: 10 }]).ok, false);
  assert.equal(checkAttachments([{ type: "image/jpeg", size: 5_000_001 }]).ok, false);
  assert.deepEqual(checkAttachments([]), { ok: true });
});

test("checkAttachments rejects inherited object keys as types", () => {
  for (const type of ["constructor", "__proto__", "toString"]) {
    assert.equal(checkAttachments([{ type, size: 10 }]).ok, false, type);
  }
});

test("isValidEta accepts real calendar dates only", () => {
  assert.equal(isValidEta("2026-10-31"), true);
  for (const bad of ["2026-02-30", "2026-1-5", "31/10/2026", ""]) {
    assert.equal(isValidEta(bad), false, bad);
  }
});

test("formatEta writes a French day and month", () => {
  assert.equal(formatEta("2026-10-31"), "31 octobre");
});

test("normalizeSearch drops accents, case and extra spaces", () => {
  assert.equal(normalizeSearch("  Réservation   ÉTÉ "), "reservation ete");
});

test("matchArticles needs every word and ranks question hits first", () => {
  const articles = [
    { id: "a", question: "Comment créer un pack ?", answer: "Depuis la page des packs prépayés." },
    { id: "b", question: "Mot de passe oublié", answer: "Le lien sert à créer un nouveau mot de passe." },
    { id: "c", question: "Synchroniser Google Agenda", answer: "Dans Réglages." },
  ];
  assert.deepEqual(matchArticles(articles, "creer").map((a) => a.id), ["a", "b"]);
  assert.deepEqual(matchArticles(articles, "créer pack").map((a) => a.id), ["a"]);
  assert.deepEqual(matchArticles(articles, "mot passe").map((a) => a.id), ["b"]);
  assert.deepEqual(matchArticles(articles, "agenda zzz"), []);
  assert.deepEqual(matchArticles(articles, "  "), []);
});

test("parseAnswer splits paragraphs and dash lists", () => {
  assert.deepEqual(parseAnswer("Premier paragraphe\nsur deux lignes.\n\n- un\n- deux\nFin."), [
    { kind: "paragraph", segments: [{ kind: "text", text: "Premier paragraphe sur deux lignes." }] },
    { kind: "list", items: [[{ kind: "text", text: "un" }], [{ kind: "text", text: "deux" }]] },
    { kind: "paragraph", segments: [{ kind: "text", text: "Fin." }] },
  ]);
});

test("parseAnswer links https URLs and app paths, trailing punctuation excluded", () => {
  assert.deepEqual(parseAnswer("Voir https://myskedul.com/aide. Ou /sign-up, ou 1/2."), [
    {
      kind: "paragraph",
      segments: [
        { kind: "text", text: "Voir " },
        { kind: "link", text: "https://myskedul.com/aide", href: "https://myskedul.com/aide" },
        { kind: "text", text: ". Ou " },
        { kind: "link", text: "/sign-up", href: "/sign-up" },
        { kind: "text", text: ", ou 1/2." },
      ],
    },
  ]);
});

test("parseAnswer never links javascript: or protocol-relative URLs", () => {
  const [block] = parseAnswer("javascript:alert(1) //evil.com http://plain.example");
  assert.ok(block.kind === "paragraph");
  assert.ok(block.segments.every((s) => s.kind === "text"));
});
