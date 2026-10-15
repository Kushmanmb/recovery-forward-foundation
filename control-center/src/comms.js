import { can } from "./rbac.js";
/** Mailbox isolation: own mailbox, or shared contact inbox (President & Secretary only). No admin override. */
export function canReadMailbox(member, mailbox) {
  if (!member || member.status !== "active") return false;
  if (mailbox.kind === "personal") return mailbox.ownerId === member.id;
  if (mailbox.kind === "shared:contact") return can(member, "inbox:contact:read");
  return false;
}
