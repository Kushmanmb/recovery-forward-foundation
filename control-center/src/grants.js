import { can } from "./rbac.js";

/** Milestone attestation: issuer != verifier; verification is independent of grant approval. */
export class Attestation {
  constructor(rcgi, issuerId) { if (!/^RCGI-[A-Z0-9-]+$/.test(rcgi)) throw new Error("bad RCGI"); this.rcgi = rcgi; this.issuerId = issuerId; this.verifiedBy = null; }
  verify(verifierId) {
    if (verifierId === this.issuerId) throw new Error("self-verification prohibited");
    this.verifiedBy = verifierId; return this;
  }
}

/** Committee approval: reviewers must have confidentiality ack, no conflict, board-appointed committee. Never triggers payment. */
export class GrantDecision {
  constructor({ committeeAuthorized }) { this.committeeAuthorized = committeeAuthorized; this.state = "pending"; }
  approve(attestation, reviewers, conflicted = []) {
    if (!this.committeeAuthorized) throw new Error("committee authority not established by bylaws/board action");
    if (!attestation.verifiedBy) throw new Error("independent verification required");
    const eligible = reviewers.filter((r) => r.confidentialityAck && !conflicted.includes(r.id));
    if (eligible.length < 2) throw new Error("insufficient eligible reviewers");
    this.state = "approved"; return this;
  }
}

/** Payment record only. Dual authorization, no self-approval, never executes transfers. */
export class PaymentRecord {
  constructor(decision, preparerId, { rcgi, amountCents, recipientVerified }) {
    if (decision.state !== "approved") throw new Error("grant not approved");
    if (!recipientVerified) throw new Error("recipient verification required");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("bad amount");
    Object.assign(this, { rcgi, amountCents, preparerId, auth: {}, executed: false, reconciledBy: null });
  }
  authorize(member, as, altApproved = false) {
    const perm = `payments:authorize:${as}`;
    if (!can(member, perm) && !altApproved) throw new Error("forbidden");
    if (member.id === this.preparerId) throw new Error("self-approval prohibited");
    if (Object.values(this.auth).includes(member.id)) throw new Error("same person cannot authorize twice");
    this.auth[as] = member.id; return this;
  }
  get fullyAuthorized() { return Boolean(this.auth.president && this.auth.treasurer); }
  /** Records an externally executed payment. This software never moves funds. */
  recordExecution(reference) {
    if (!this.fullyAuthorized) throw new Error("dual authorization required");
    this.executed = true; this.reference = reference; return this;
  }
  reconcile(memberId) {
    if (!this.executed) throw new Error("not executed");
    if (Object.values(this.auth).includes(memberId) || memberId === this.preparerId) throw new Error("independent reconciliation required");
    this.reconciledBy = memberId; return this;
  }
}

/** Applicant isolation: access by authenticated applicant id + ownership, never by RCGI alone. */
export class ApplicantStore {
  #apps = new Map();
  register(applicantId, rcgi) { this.#apps.set(rcgi, { applicantId, status: "registered" }); }
  status(session, rcgi) {
    const a = this.#apps.get(rcgi);
    if (!session?.applicantId || !a || a.applicantId !== session.applicantId) throw new Error("not found");
    return a.status;
  }
}

/** Registry integration contract. MOCK only: the real registry API was not available for inspection. */
export class MockRegistry {
  #log = [];
  register(rcgi) { this.#log.push({ rcgi, stage: "registered" }); return { live: false }; }
  get entries() { return this.#log.map((e) => ({ ...e })); }
}
