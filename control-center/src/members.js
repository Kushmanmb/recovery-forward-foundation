import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { can, ROLES } from "./rbac.js";

const hash = (t) => createHash("sha256").update(t).digest();
const INVITE_TTL_MS = 48 * 3600 * 1000;

/**
 * Member lifecycle: invited -> accepted (identity verified, MFA enrolled, policies acknowledged)
 * -> active (ONLY by explicit President activation) ; active <-> suspended.
 * No public registration: the only way to create a member is invite() by an active President.
 */
export class MemberDirectory {
  #m = new Map(); #invites = new Map(); #sessions = new Map();
  constructor(audit, now = () => Date.now()) { this.audit = audit; this.now = now; }

  /** One-time bootstrap. Email comes from deployment secret, never from source. */
  bootstrapPresident(email) {
    if ([...this.#m.values()].some((x) => x.role === "President")) throw new Error("president exists");
    const p = { id: "m1", email, role: "President", status: "pending", mfa: false, identityVerified: false, policiesAck: false };
    this.#m.set(p.id, p); this.audit.append("system", "bootstrap_president", { id: p.id });
    return p.id;
  }
  /** Bootstrap President still needs MFA + identity + acknowledgements before self-activation of the first account. */
  completeBootstrap(id) {
    const p = this.#m.get(id);
    if (p?.role !== "President" || !(p.mfa && p.identityVerified && p.policiesAck)) throw new Error("bootstrap requirements incomplete");
    p.status = "active"; this.audit.append(id, "bootstrap_activated", {});
  }
  get(id) { return this.#m.get(id); }

  invite(actorId, email, role) {
    this.#require(actorId, "members:invite");
    if (!ROLES.includes(role) || role === "President") throw new Error("invalid role");
    const token = randomBytes(32).toString("base64url");
    const id = "m" + (this.#m.size + 1);
    this.#m.set(id, { id, email, role, status: "invited", mfa: false, identityVerified: false, policiesAck: false });
    this.#invites.set(id, { h: hash(token), exp: this.now() + INVITE_TTL_MS, used: false });
    this.audit.append(actorId, "invite", { id, role });
    return { id, token }; // token delivered out-of-band; only its hash is stored
  }
  acceptInvite(id, token, { identityVerified, mfaEnrolled, policiesAck }) {
    const inv = this.#invites.get(id), m = this.#m.get(id);
    if (!inv || !m || inv.used || this.now() > inv.exp) throw new Error("invalid invitation");
    const h = hash(token);
    if (!timingSafeEqual(h, inv.h)) throw new Error("invalid invitation");
    if (!(identityVerified && mfaEnrolled && policiesAck)) throw new Error("verification, MFA and acknowledgements required");
    inv.used = true; Object.assign(m, { status: "accepted", identityVerified: true, mfa: true, policiesAck: true });
    this.audit.append(id, "invite_accepted", {});
  }
  activate(actorId, id) {
    this.#require(actorId, "members:activate");
    const m = this.#m.get(id);
    if (m?.status !== "accepted") throw new Error("member must complete onboarding first");
    m.status = "active"; this.audit.append(actorId, "activate", { id });
  }
  suspend(actorId, id, reason) {
    this.#require(actorId, "members:suspend");
    const m = this.#m.get(id);
    if (!m) throw new Error("unknown member");
    if (id === actorId) throw new Error("cannot suspend self");
    m.status = "suspended"; this.revokeSessions(id);
    this.audit.append(actorId, "suspend", { id, reason });
  }
  reinstate(actorId, id) {
    this.#require(actorId, "members:suspend");
    const m = this.#m.get(id);
    if (m?.status !== "suspended") throw new Error("not suspended");
    m.status = "active"; this.audit.append(actorId, "reinstate", { id });
  }
  setPermissions(actorId, id, { grants = [], revokes = [] }) {
    this.#require(actorId, "members:permissions");
    const m = this.#m.get(id); if (!m) throw new Error("unknown member");
    Object.assign(m, { grants, revokes }); this.audit.append(actorId, "permissions_changed", { id, grants, revokes });
  }
  // Sessions
  createSession(id) {
    const m = this.#m.get(id);
    if (m?.status !== "active" || !m.mfa) throw new Error("login denied");
    const s = randomBytes(32).toString("base64url"); this.#sessions.set(s, id); return s;
  }
  /** Checked on EVERY request: suspended members fail even with a previously issued token. */
  authenticate(session) {
    const m = this.#m.get(this.#sessions.get(session));
    return m?.status === "active" ? m : null;
  }
  revokeSessions(id) { for (const [s, mid] of this.#sessions) if (mid === id) this.#sessions.delete(s); }
  #require(actorId, perm) {
    if (!can(this.#m.get(actorId), perm)) { this.audit.append(actorId, "denied", { perm }); throw new Error("forbidden"); }
  }
}
