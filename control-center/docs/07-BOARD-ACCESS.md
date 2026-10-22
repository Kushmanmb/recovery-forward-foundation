# Board access implementation

This change adds the Board access and Audit activity screens to the existing private Worker. It does not deploy, change Access policies, send email, or modify the public site.

## Flow

1. An active President creates an invitation for VicePresident, Secretary, Treasurer, or BoardMember. A random 256-bit token is shown once and stored only as SHA-256. The invitation expires after 48 hours.
2. The President privately delivers the token to the intended officer. The officer's exact email must be admitted by the approved Cloudflare Access policy, which must require MFA. No API changes the Access policy.
3. The officer signs in through Access and enters the token in the command center. The verified Access email must match the invitation. Acceptance records policy acknowledgement and creates a pending member atomically with the audit event. Tokens are never placed in URLs or browser storage.
4. Pending officers can obtain a restricted session and view their activation status. They receive no role permissions and cannot access the roster, audit, Registry, or other administrative APIs.
5. The President independently checks identity and MFA enrollment, checks both attestations in the UI, and explicitly activates the officer. These are recorded manual attestations, not automatic proof of MFA by the Worker.
6. Suspension requires a reason, records an audit event, and revokes all target sessions in the same transaction. Reinstatement requires previous activation and verification; revoked sessions stay revoked and the officer must sign in again.

Only the active President can administer or read the roster. President accounts cannot be invited, suspended, or replaced through these endpoints. Role changes and self-service recovery are not implemented. Expired or revoked unused invitations can be replaced; existing members cannot be overwritten. Failed audit writes roll back state changes. Responses use `Cache-Control: no-store`.

## Endpoints

| Method | Path | Authorization |
| --- | --- | --- |
| GET | `/api/board` | Active President and D1 session |
| POST | `/api/board/invite` | Active President, D1 session, same origin JSON |
| POST | `/api/board/accept` | Verified Access identity matching the token, same origin JSON |
| POST | `/api/board/activate` | Active President; identity/MFA attestations |
| POST | `/api/board/suspend` | Active President; suspension reason |
| POST | `/api/board/reinstate` | Active President; previously verified and activated target |
| POST | `/api/board/revoke` | Active President; unused invitation |

## Rollout

Before any production deployment, compare the actual D1 schema and migration history with this branch. Apply `0003_board_access.sql` to an approved staging database and test with synthetic identities. The filename reserves 0002 for the separate application-inbox branch; it does not imply that migration is present or required. An older `board_invitations` table is not automatically migrated into this new, distinctly named table.

The Worker and UI must be deployed together after the migration. Do not deploy the UI alone or change the public Pages directory. Verify the President identity and Access MFA enforcement, invite expiry, email mismatch, single use, manual activation, role denial, suspension, and fresh sign-in after reinstatement. Automated invitation delivery, recovery, independent operational security review, and step-up authentication remain work to complete before general board rollout.

Rollback to the prior Worker/UI while retaining Access and existing D1 records; do not drop audit history or invitation tables as a rollback shortcut.
