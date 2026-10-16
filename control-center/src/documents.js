import { can } from "./rbac.js";
const CLASS_PERM = { board: "documents:board:read", finance: "documents:finance:write", records: "documents:records:write" };
/** Docs are served only via authorized, short-lived, unguessable references; never public URLs. */
export function canReadDocument(member, doc) {
  const perm = CLASS_PERM[doc.classification];
  return Boolean(perm) && (can(member, perm) || (doc.classification === "finance" && can(member, "finance:read")));
}
