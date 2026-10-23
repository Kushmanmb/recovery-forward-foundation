export const RCGI_PATTERN = /^RCGI-[0-9a-f]{12}$/;
export const RECOVERY_STAGES = [
  "Currently in treatment",
  "Less than 3 months in recovery",
  "3–6 months in recovery",
  "6–12 months in recovery",
  "More than 1 year in recovery",
];
export const NEEDS = ["employment", "education", "transportation", "housing", "recovery-support", "other"];
export const STATUSES = ["new", "assigned", "in_review", "recommended", "not_recommended", "closed"];
export const REVIEWER_STATUSES = ["in_review", "recommended", "not_recommended"];

export const MAX_INTAKE_BYTES = 8 * 1024;
const TEXT_LIMITS = { recoverySupport: 1000, needDescription: 1500, goals: 1500 };
const FIELDS = ["rcgi", "recoveryStage", "recoverySupport", "needs", "needDescription", "goals", "confirmation"];

/** Strict allowlist validation. Returns a normalized submission or null; never echoes input. */
export function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !FIELDS.includes(key))) return null;
  if (typeof body.rcgi !== "string" || !RCGI_PATTERN.test(body.rcgi)) return null;
  if (!RECOVERY_STAGES.includes(body.recoveryStage)) return null;
  if (body.confirmation !== true) return null;
  if (!Array.isArray(body.needs) || body.needs.length < 1 || body.needs.length > NEEDS.length
    || new Set(body.needs).size !== body.needs.length || !body.needs.every((need) => NEEDS.includes(need))) return null;
  const text = {};
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    if (typeof body[key] !== "string") return null;
    const value = body[key].trim();
    if (!value || value.length > limit) return null;
    text[key] = value;
  }
  return { rcgi: body.rcgi, recoveryStage: body.recoveryStage, needs: [...body.needs], ...text };
}

/** Insert-only. Application and content-free audit insertion share one D1 transaction. */
export async function storeSubmission(db, submission) {
  const now = Date.now();
  const insertApplication = db.prepare(
    "INSERT OR IGNORE INTO applications (rcgi, recovery_stage, recovery_support, needs_json, need_description, goals, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)",
  ).bind(submission.rcgi, submission.recoveryStage, submission.recoverySupport, JSON.stringify(submission.needs),
    submission.needDescription, submission.goals, now, now);
  const insertAuditIfInserted = db.prepare(
    "INSERT INTO audit_log (actor_email, action, detail_json, created_at) SELECT ?, ?, ?, ? WHERE changes() > 0",
  ).bind("system:intake", "application_received", JSON.stringify({ rcgi: submission.rcgi }), now);
  const results = await db.batch([insertApplication, insertAuditIfInserted]);
  return (results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) > 0;
}

export function applicationSummary(row) {
  return {
    rcgi: row.rcgi,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function applicationDetail(row) {
  return {
    ...applicationSummary(row),
    assignedAt: row.assigned_at,
    recoveryStage: row.recovery_stage,
    recoverySupport: row.recovery_support,
    needs: JSON.parse(row.needs_json),
    needDescription: row.need_description,
    goals: row.goals,
  };
}
