export const APPROVAL_RULES = ["majority_votes_cast", "majority_present", "majority_all_directors", "two_thirds_present"];
const DAY_MS = 86_400_000;

/** Rules are usable only when every field was transcribed and attested; otherwise official action is blocked. */
export function rulesVerified(rules) {
  return Boolean(rules
    && Number.isInteger(rules.director_count) && rules.director_count > 0
    && Number.isInteger(rules.quorum) && rules.quorum > 0 && rules.quorum <= rules.director_count
    && APPROVAL_RULES.includes(rules.approval_rule)
    && Number.isInteger(rules.notice_days) && rules.notice_days >= 0
    && rules.source_document && rules.statutory_basis && rules.verified_by && rules.verified_at);
}

export function noticeSatisfied(rules, noticeSentAt, meetingAt) {
  return Number.isFinite(noticeSentAt) && meetingAt - noticeSentAt >= rules.notice_days * DAY_MS;
}

export function quorumStatus(rules, present) {
  return { present, required: rules?.quorum ?? null, met: Boolean(rules && present >= rules.quorum) };
}

/** Recused directors stay counted as present for quorum and for presence-based denominators (conservative). */
export function tally(rules, { yes, no, abstain, present }) {
  let passed;
  switch (rules.approval_rule) {
    case "majority_votes_cast": passed = yes > no; break;
    case "majority_present": passed = yes * 2 > present; break;
    case "majority_all_directors": passed = yes * 2 > rules.director_count; break;
    case "two_thirds_present": passed = yes > 0 && yes * 3 >= present * 2; break;
    default: passed = false;
  }
  return { yes, no, abstain, present, rule: rules.approval_rule, passed };
}

export function countVotes(votes) {
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const vote of votes) if (vote.choice in counts) counts[vote.choice] += 1;
  return counts;
}
