import { createHash } from "node:crypto";

const GENESIS = "0".repeat(64);

function digest(prev, entry) {
  return createHash("sha256").update(prev + JSON.stringify(entry)).digest("hex");
}

/** Append-only, hash-chained audit log. Tamper-evident (not tamper-proof): anchor head hash externally. */
export class AuditLog {
  #entries = [];
  append(actor, action, detail = {}) {
    const prev = this.#entries.length ? this.#entries[this.#entries.length - 1].hash : GENESIS;
    const body = { seq: this.#entries.length, ts: new Date().toISOString(), actor, action, detail };
    const entry = Object.freeze({ ...body, prev, hash: digest(prev, body) });
    this.#entries.push(entry);
    return entry;
  }
  get entries() { return this.#entries.map((e) => ({ ...e })); }
  get head() { return this.#entries.length ? this.#entries[this.#entries.length - 1].hash : GENESIS; }
  static verify(entries) {
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i++) {
      const { prev: p, hash, ...body } = entries[i];
      if (p !== prev || body.seq !== i || digest(prev, body) !== hash) return { ok: false, at: i };
      prev = hash;
    }
    return { ok: true };
  }
}
