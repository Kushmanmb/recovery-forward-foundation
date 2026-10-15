import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/index.js";

// Synthetic fixtures only.
function setup() {
  const audit = new C.AuditLog(); let t = Date.now();
  const dir = new C.MemberDirectory(audit, () => t);
  const pid = dir.bootstrapPresident("president@example.invalid");
  Object.assign(dir.get(pid), { mfa: true, identityVerified: true, policiesAck: true });
  dir.completeBootstrap(pid);
  const onboard = (role) => {
    const { id, token } = dir.invite(pid, `${role}@example.invalid`, role);
    dir.acceptInvite(id, token, { identityVerified: true, mfaEnrolled: true, policiesAck: true });
    dir.activate(pid, id); return id;
  };
  return { audit, dir, pid, onboard, tick: (ms) => (t += ms) };
}

test("bootstrap requires MFA, identity and acknowledgements", () => {
  const d = new C.MemberDirectory(new C.AuditLog()); const id = d.bootstrapPresident("p@example.invalid");
  assert.throws(() => d.completeBootstrap(id)); assert.throws(() => d.bootstrapPresident("x@example.invalid"));
});
test("only President can invite; no President role via invite; role escalation blocked", () => {
  const { dir, pid, onboard } = setup(); const sec = onboard("Secretary");
  assert.throws(() => dir.invite(sec, "a@example.invalid", "BoardMember"), /forbidden/);
  assert.throws(() => dir.invite(pid, "a@example.invalid", "President"), /invalid role/);
  assert.throws(() => dir.setPermissions(sec, sec, { grants: ["members:invite"] }), /forbidden/);
});
test("invitation: expiring, single use, hashed, manual activation required", () => {
  const { dir, pid, tick } = setup();
  const a = dir.invite(pid, "a@example.invalid", "Treasurer");
  assert.throws(() => dir.acceptInvite(a.id, "wrong", { identityVerified: true, mfaEnrolled: true, policiesAck: true }));
  assert.throws(() => dir.acceptInvite(a.id, a.token, { identityVerified: true, mfaEnrolled: false, policiesAck: true }));
  dir.acceptInvite(a.id, a.token, { identityVerified: true, mfaEnrolled: true, policiesAck: true });
  assert.throws(() => dir.createSession(a.id), /denied/);          // accepted but not activated
  assert.throws(() => dir.acceptInvite(a.id, a.token, { identityVerified: true, mfaEnrolled: true, policiesAck: true })); // single use
  const b = dir.invite(pid, "b@example.invalid", "BoardMember"); tick(49 * 3600 * 1000);
  assert.throws(() => dir.acceptInvite(b.id, b.token, { identityVerified: true, mfaEnrolled: true, policiesAck: true }), /invalid/);
  assert.throws(() => dir.activate(pid, b.id));
});
test("suspension revokes sessions immediately; cannot suspend self", () => {
  const { dir, pid, onboard } = setup(); const id = onboard("BoardMember"); const s = dir.createSession(id);
  assert.ok(dir.authenticate(s)); dir.suspend(pid, id, "test"); assert.equal(dir.authenticate(s), null);
  assert.throws(() => dir.createSession(id)); assert.throws(() => dir.suspend(pid, pid, "x"));
  dir.reinstate(pid, id); assert.equal(dir.authenticate(s), null); // old session stays dead
});
test("RBAC default deny; admin has no mailbox or extra vote rights", () => {
  const { dir, pid, onboard } = setup(); const sec = onboard("Secretary"); const bm = onboard("BoardMember");
  assert.equal(C.can(dir.get(bm), "finance:write"), false);
  assert.equal(C.can({ ...dir.get(pid), grants: ["mailbox:others:read"] }, "mailbox:others:read"), false);
  assert.equal(C.canReadMailbox(dir.get(pid), { kind: "personal", ownerId: bm }), false);
  assert.equal(C.canReadMailbox(dir.get(bm), { kind: "personal", ownerId: bm }), true);
  assert.equal(C.canReadMailbox(dir.get(sec), { kind: "shared:contact" }), true);
  assert.equal(C.canReadMailbox(dir.get(pid), { kind: "shared:contact" }), true);
  assert.equal(C.canReadMailbox(dir.get(bm), { kind: "shared:contact" }), false);
});
test("documents: classification enforced", () => {
  const { dir, onboard } = setup(); const bm = dir.get(onboard("BoardMember"));
  assert.equal(C.canReadDocument(bm, { classification: "board" }), true);
  assert.equal(C.canReadDocument(bm, { classification: "grants-confidential" }), false);
});
test("audit chain detects tampering and records denials", () => {
  const { audit, dir, onboard } = setup(); const bm = onboard("BoardMember");
  assert.throws(() => dir.invite(bm, "z@example.invalid", "BoardMember"));
  assert.ok(audit.entries.some((e) => e.action === "denied"));
  assert.equal(C.AuditLog.verify(audit.entries).ok, true);
  const e = audit.entries; e[2].detail = { forged: true }; assert.equal(C.AuditLog.verify(e).ok, false);
  const r = audit.entries; r.splice(1, 1); assert.equal(C.AuditLog.verify(r).ok, false);
});

const verified = () => new C.GovernanceConfig({ verifiedBy: "counsel", sourceDocument: "bylaws-v1", directorCount: 5, quorum: 3, approvalThreshold: 3, noticeDays: 5, writtenConsentPermitted: true });
test("unverified governance config prevents finalization", () => {
  const m = new C.Meeting(new C.GovernanceConfig({}), ["a", "b", "c"]);
  ["a", "b", "c"].forEach((d) => m.markPresent(d, true)); m.motion(1, "x");
  assert.throws(() => m.hasQuorum(), /unverified/); assert.throws(() => m.finalize(1), /unverified/);
  assert.throws(() => new C.WrittenConsent(new C.GovernanceConfig({}), ["a"], "x").finalize(), /unverified/);
  assert.throws(() => C.checkNotice(new C.GovernanceConfig({}), 0, 1e9));
});
test("quorum, identity verification, recusal, eligible voting", () => {
  const m = new C.Meeting(verified(), ["a", "b", "c", "d", "e"]);
  m.markPresent("a", true); m.markPresent("b", true); m.markPresent("c", false); m.markPresent("outsider", true);
  assert.equal(m.hasQuorum(), false); m.markPresent("c", true); assert.equal(m.hasQuorum(), true);
  m.motion(1, "approve"); m.disclose("c", 1);
  assert.throws(() => m.vote(1, "c", "yes"), /recused/); assert.throws(() => m.vote(1, "d", "yes"), /not present/);
  m.vote(1, "a", "yes"); m.vote(1, "b", "yes"); assert.equal(m.finalize(1), "failed"); // recusal reduces yes votes below threshold
});
test("carried motion needs threshold; notice check", () => {
  const m = new C.Meeting(verified(), ["a", "b", "c"]); ["a", "b", "c"].forEach((d) => m.markPresent(d, true)); m.motion(1, "x");
  ["a", "b", "c"].forEach((d) => m.vote(1, d, "yes")); assert.equal(m.finalize(1), "carried");
  assert.equal(C.checkNotice(verified(), 0, 4 * 86400000), false); assert.equal(C.checkNotice(verified(), 0, 5 * 86400000), true);
});
test("written consent: unanimous and legally permitted only", () => {
  const wc = new C.WrittenConsent(verified(), ["a", "b"], "x"); wc.respond("a", "consent");
  assert.throws(() => wc.finalize()); assert.throws(() => wc.respond("zz", "consent"));
  wc.respond("b", "object"); assert.throws(() => wc.finalize()); wc.respond("b", "consent"); assert.equal(wc.finalize(), "adopted");
  const cfg = new C.GovernanceConfig({ ...verified().cfg, writtenConsentPermitted: false });
  const w2 = new C.WrittenConsent(cfg, ["a"], "x"); w2.respond("a", "consent"); assert.throws(() => w2.finalize(), /permitted/);
});
test("official records immutable; amendments preserve original", () => {
  const r = new C.OfficialRecord("minutes", { approvedBy: ["a"], signedBy: "sec" });
  assert.throws(() => { r.original.content = "changed"; }); assert.throws(() => r.versions.push({}));
  assert.throws(() => r.amend("fix", null, "typo")); const v = r.amend("fix", "board", "typo");
  assert.equal(v[0].content, "minutes"); assert.equal(v[1].type, "amendment");
  assert.throws(() => new C.OfficialRecord("m", { approvedBy: [] }));
});

test("attestation separation of duties and RCGI format", () => {
  const a = new C.Attestation("RCGI-ABC-123", "provider1");
  assert.throws(() => a.verify("provider1")); assert.equal(a.verify("verifier1").verifiedBy, "verifier1");
  assert.throws(() => new C.Attestation("bad", "p"));
});
test("grant approval needs authority, verification, eligible reviewers; no payment side effect", () => {
  const a = new C.Attestation("RCGI-X-1", "p"); const rv = [{ id: "r1", confidentialityAck: true }, { id: "r2", confidentialityAck: true }, { id: "r3", confidentialityAck: false }];
  assert.throws(() => new C.GrantDecision({ committeeAuthorized: false }).approve(a, rv), /authority/);
  assert.throws(() => new C.GrantDecision({ committeeAuthorized: true }).approve(a, rv), /verification/);
  a.verify("v"); assert.throws(() => new C.GrantDecision({ committeeAuthorized: true }).approve(a, rv, ["r1"]), /reviewers/);
  assert.equal(new C.GrantDecision({ committeeAuthorized: true }).approve(a, rv).state, "approved");
});
test("dual payment authorization, no self-approval, independent reconciliation", () => {
  const { dir, pid, onboard } = setup(); const tr = dir.get(onboard("Treasurer")); const pres = dir.get(pid); const bm = dir.get(onboard("BoardMember"));
  const a = new C.Attestation("RCGI-X-1", "p").verify("v");
  const d = new C.GrantDecision({ committeeAuthorized: true }).approve(a, [{ id: "r1", confidentialityAck: true }, { id: "r2", confidentialityAck: true }]);
  assert.throws(() => new C.PaymentRecord({ state: "pending" }, "x", { rcgi: "RCGI-X-1", amountCents: 1, recipientVerified: true }));
  assert.throws(() => new C.PaymentRecord(d, "x", { rcgi: "RCGI-X-1", amountCents: 1, recipientVerified: false }));
  const p = new C.PaymentRecord(d, tr.id, { rcgi: "RCGI-X-1", amountCents: 5000, recipientVerified: true });
  assert.throws(() => p.authorize(tr, "treasurer"), /self-approval/);       // preparer cannot approve
  assert.throws(() => p.authorize(bm, "president"), /forbidden/);
  assert.throws(() => p.recordExecution("ref"), /dual/);
  p.authorize(pres, "president"); assert.throws(() => p.recordExecution("ref"));
  const p2 = new C.PaymentRecord(d, bm.id, { rcgi: "RCGI-X-1", amountCents: 5000, recipientVerified: true });
  p2.authorize(pres, "president"); assert.throws(() => p2.authorize(pres, "treasurer", true), /twice/);
  p2.authorize(tr, "treasurer"); p2.recordExecution("ref-1");
  assert.throws(() => p2.reconcile(pres.id)); p2.reconcile("independent");
});
test("applicant cannot access other applications or use RCGI alone", () => {
  const s = new C.ApplicantStore(); s.register("app1", "RCGI-A-1"); s.register("app2", "RCGI-B-2");
  assert.equal(s.status({ applicantId: "app1" }, "RCGI-A-1"), "registered");
  assert.throws(() => s.status({ applicantId: "app1" }, "RCGI-B-2")); assert.throws(() => s.status(null, "RCGI-A-1"));
  assert.throws(() => s.status({ applicantId: "app1" }, "RCGI-A-2"));
});
test("registry mock is flagged non-live", () => assert.equal(new C.MockRegistry().register("RCGI-A-1").live, false));
