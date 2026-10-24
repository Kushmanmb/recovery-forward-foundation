# Staging end-to-end checklist (synthetic data only)

Use dedicated test identities, never real members or real resolutions. Suggested accounts (replace with your own test addresses on the staging Access allow list): `president`, `secretary`, `vp`, `treasurer`, `member1`, `member2`, and `outsider` (not on the Access policy). Mark each box and record the date and tester.

## A. Isolation and authentication
- [ ] `npm run staging:check:deploy` passes; `wrangler whoami` shows the intended account.
- [ ] `GET https://admin-staging.../` with no Access cookie redirects to Access login (no content).
- [ ] `outsider` is refused by Access.
- [ ] Login without MFA is not possible (try a test account with MFA disabled).
- [ ] `*.workers.dev` URL for the staging Worker does not exist; direct request with a forged `cf-access-jwt-assertion` header returns 401.
- [ ] Security page (President) shows Environment `staging`, Access configured `yes`, President identity configured `yes`.
- [ ] Production hostname and production D1 show no new rows or tables from this testing.

## B. President setup and board access
- [ ] `president` signs in, completes setup acknowledgement.
- [ ] President invites `secretary`, `vp`, `treasurer`, `member1`, `member2`; tokens are shown once.
- [ ] Each invitee accepts with the token; status is pending and sees only the activation screen.
- [ ] President activates each after confirming identity and MFA; a non-President gets no Board access or Audit tabs and 403 on `/api/board`, `/api/audit`.
- [ ] Suspend `member2` with a reason; their session stops working; reinstate.

## C. Governance rules and directors
- [ ] Before rules are verified: Overview shows "Official action is blocked"; seating a director, starting a meeting and finalizing are refused.
- [ ] President records synthetic rules (for example 5 directors, quorum 3, majority present, 3-day notice) with attestation. Non-President cannot.
- [ ] Seat five directors; a sixth seat is refused. The Secretary is not seated, which proves the role alone confers no vote.

## D. Proposals
- [ ] `member1` creates, edits (stale edit refused), and submits a proposal; other members cannot see the draft before submission.
- [ ] `member1` cannot review their own proposal; `secretary` returns it with a note, then approves it after revision.
- [ ] Archive a separate draft with a reason; archived proposal is read-only.

## E. Meetings, quorum and voting
- [ ] Secretary schedules a meeting at least the notice period ahead, assigns the proposal, adds an agenda item, records notice. A meeting with too-short notice cannot start.
- [ ] Record attendance for two directors: start is refused (no quorum). Record a third: start succeeds.
- [ ] Open voting. Secretary (non-director) cannot vote; a seated director who is not present cannot vote.
- [ ] Each present director votes Yes/No/Abstain once; a second vote is refused and the first is unchanged.
- [ ] A director declares a conflict of interest before voting and cannot vote; recusal after voting is refused.
- [ ] While voting is open, only counts are visible; after closing, the roll call and result are shown.
- [ ] While voting is open (before closing), President adds a new set of rules; the motion still closes under the original rules. Repeat after closing: finalization still uses the original rules.
- [ ] A Treasurer or board member cannot close voting or finalize (403).

## F. Official resolution and minutes
- [ ] Secretary sees the verification checklist, confirms the bylaws box, and finalizes; a numbered resolution with a hash appears under Documents. Finalizing twice is refused.
- [ ] Minutes: Secretary drafts; the drafter cannot approve; President approves after adjournment; approved text cannot change.
- [ ] Adjourn is refused while a motion is still voting.

## G. Dashboard
- [ ] Every nav item opens on a phone-width screen (about 375px) and desktop; no horizontal scrolling of the page.
- [ ] Applications, Finance and Communications show "Not operational"; Documents shows file storage not operational; Grants shows registry unavailable when no registry is configured.
- [ ] Calendar lists the synthetic meetings; no personal data appears in HTML source beyond signed-in members.
- [ ] Sign out revokes the session (the old cookie returns 401).

## H. Audit
- [ ] As President, Audit shows entries for invitations, rules verified, seating, voting opened and closed, `vote_cast` (no vote choices), recusal, finalization and denied attempts.
- [ ] No tokens, cookies or vote choices appear in audit details or Worker logs.

Sign-off requires every box checked, then a written go/no-go from the President before any production step.
