// Governance rules are CONFIG sourced from verified bylaws / Indiana law. Unverified config blocks finalization.
export class GovernanceConfig {
  constructor(cfg = {}) { this.cfg = cfg; }
  get verified() {
    const c = this.cfg;
    return Boolean(c.verifiedBy && c.sourceDocument && Number.isInteger(c.directorCount) && c.directorCount > 0 &&
      Number.isInteger(c.quorum) && c.quorum > 0 && c.quorum <= c.directorCount &&
      Number.isInteger(c.approvalThreshold) && c.approvalThreshold > 0 && Number.isInteger(c.noticeDays));
  }
}
function needVerified(cfg) { if (!cfg.verified) throw new Error("governance rules unverified: cannot finalize"); }

export function checkNotice(cfg, noticeSentAt, meetingAt) {
  needVerified(cfg);
  return meetingAt - noticeSentAt >= cfg.cfg.noticeDays * 86400000;
}

/** Eligible = listed director, not recused. App role is irrelevant to voting rights. */
export class Meeting {
  constructor(cfg, directors) { this.cfg = cfg; this.directors = new Set(directors); this.present = new Set(); this.recused = new Map(); this.motions = []; this.conflicts = []; }
  markPresent(id, identityVerified) { if (this.directors.has(id) && identityVerified) this.present.add(id); }
  hasQuorum() { needVerified(this.cfg); return this.present.size >= this.cfg.cfg.quorum; }
  disclose(id, motionId) { this.conflicts.push({ id, motionId }); this.recused.set(motionId, new Set([...(this.recused.get(motionId) ?? []), id])); }
  motion(id, text) { this.motions.push({ id, text, votes: new Map(), result: null }); }
  vote(motionId, directorId, choice) {
    const m = this.motions.find((x) => x.id === motionId);
    if (!m || m.result) throw new Error("motion unavailable");
    if (!this.present.has(directorId)) throw new Error("not present");
    if (this.recused.get(motionId)?.has(directorId)) throw new Error("recused");
    if (!["yes", "no", "abstain"].includes(choice)) throw new Error("bad choice");
    m.votes.set(directorId, choice);
  }
  finalize(motionId) {
    needVerified(this.cfg);
    if (!this.hasQuorum()) throw new Error("no quorum");
    const m = this.motions.find((x) => x.id === motionId);
    const yes = [...m.votes.values()].filter((v) => v === "yes").length;
    m.result = yes >= this.cfg.cfg.approvalThreshold ? "carried" : "failed";
    return m.result;
  }
}

/** Action without a meeting: requires consent of ALL directors, only if legally permitted (config flag). */
export class WrittenConsent {
  constructor(cfg, directors, text) { this.cfg = cfg; this.directors = new Set(directors); this.text = text; this.responses = new Map(); }
  respond(id, choice) {
    if (!this.directors.has(id)) throw new Error("not a director");
    if (!["consent", "object"].includes(choice)) throw new Error("bad choice");
    this.responses.set(id, choice);
  }
  finalize() {
    needVerified(this.cfg);
    if (this.cfg.cfg.writtenConsentPermitted !== true) throw new Error("written consent not verified as permitted");
    const ok = [...this.directors].every((d) => this.responses.get(d) === "consent");
    if (!ok) throw new Error("unanimous written consent required");
    return "adopted";
  }
}

/** Finalized records are frozen; corrections create amendments preserving the original. */
export class OfficialRecord {
  constructor(content, { approvedBy, signedBy }) {
    if (!approvedBy?.length || !signedBy) throw new Error("approval and signature required");
    this.versions = [Object.freeze({ v: 1, content, approvedBy: [...approvedBy], signedBy, type: "original" })];
    Object.freeze(this.versions);
  }
  get original() { return this.versions[0]; }
  amend(content, authorizedBy, reason) {
    if (!authorizedBy || !reason) throw new Error("authorized amendment with reason required");
    return Object.freeze([...this.versions, Object.freeze({ v: this.versions.length + 1, content, authorizedBy, reason, type: "amendment" })]);
  }
}
