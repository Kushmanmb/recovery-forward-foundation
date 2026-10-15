// Default-deny RBAC. Application admin role confers NO governance rights (votes, mailbox access).
export const ROLES = ["President", "VicePresident", "Secretary", "Treasurer", "BoardMember"];

export const ROLE_PERMISSIONS = {
  President: ["members:invite", "members:activate", "members:suspend", "members:permissions", "security:read", "audit:read",
    "documents:board:read", "meetings:request", "agenda:propose", "inbox:contact:read", "payments:authorize:president",
    "finance:read", "grants:summary:read"],
  VicePresident: ["documents:board:read", "meetings:request", "agenda:propose", "finance:read", "grants:summary:read"],
  Secretary: ["documents:board:read", "documents:records:write", "minutes:draft", "meetings:request", "agenda:propose",
    "inbox:contact:read", "finance:read", "grants:summary:read"],
  Treasurer: ["documents:board:read", "documents:finance:write", "finance:read", "finance:write", "meetings:request",
    "agenda:propose", "payments:prepare", "payments:authorize:treasurer", "grants:summary:read"],
  BoardMember: ["documents:board:read", "meetings:request", "agenda:propose", "finance:read", "grants:summary:read"],
};

// Never grantable via individual adjustment.
const NON_GRANTABLE = new Set(["mailbox:others:read", "votes:extra", "audit:write"]);

/** member: { id, role, status, grants?: string[], revokes?: string[] } */
export function can(member, permission) {
  if (!member || member.status !== "active") return false;
  const base = ROLE_PERMISSIONS[member.role];
  if (!base || NON_GRANTABLE.has(permission)) return false;
  if (member.revokes?.includes(permission)) return false;
  return base.includes(permission) || Boolean(member.grants?.includes(permission));
}
