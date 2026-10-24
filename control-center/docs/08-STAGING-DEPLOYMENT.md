# Staging deployment

Staging is a separate Worker, hostname, Access application and D1 database. Nothing here touches production (`wrangler.toml`). Every command below must include `--config wrangler.staging.toml`, and every step that changes Cloudflare needs explicit owner approval.

| Resource | Production | Staging |
| --- | --- | --- |
| Worker | `recovery-forward-control-center` | `recovery-forward-control-center-staging` |
| Hostname | `admin.recoveryforwardfoundation.org` | `admin-staging.recoveryforwardfoundation.org` |
| D1 | `recovery-forward-control-center-db` | `recovery-forward-control-center-staging-db` (new id) |
| Access app and AUD | production | separate staging app and AUD |
| Secrets | production | staging-only values |
| `workers.dev` / preview URLs | off | off |

`npm run staging:check` (in `control-center/`) fails if staging shares the production Worker name, D1 id or name, hostname, or sets identity settings in the file. `npm run staging:check:deploy` also fails while `REPLACE_WITH_STAGING_D1_DATABASE_ID` remains. Both are covered by `test/staging-validation.test.js`.

## Preconditions

- PR #34 is reviewed. This work does not require merging it; deploy from the reviewed branch commit.
- A Cloudflare account/API token scoped to staging resources, and `wrangler whoami` shows the intended account.
- A named list of synthetic test identities on an IdP that enforces MFA. Do not use real board members.

## Steps

1. **Create the staging D1 database** and record its id.
   `npx wrangler d1 create recovery-forward-control-center-staging-db`
   Put the id into `database_id` in `wrangler.staging.toml`, then run `npm run staging:check:deploy`.
2. **Create the Cloudflare Access application first** (Zero Trust, self-hosted) for `admin-staging.recoveryforwardfoundation.org`, covering the whole hostname including `/api/*`.
   - Policy: Allow only the named synthetic test emails.
   - Add a Require rule for MFA (an authentication-method/MFA rule, or an IdP that enforces MFA and passes it to Access). The Worker cannot verify this itself.
   - Session duration of 8 hours or less. The Worker rejects tokens whose lifetime exceeds 8 hours.
   - Record the application's AUD tag and the team domain (`<team>.cloudflareaccess.com`).
3. **Set staging-only secrets** (the Worker returns 503 and serves nothing until all are present):
   `npx wrangler secret put ACCESS_TEAM_DOMAIN --config wrangler.staging.toml`
   `npx wrangler secret put ACCESS_AUD --config wrangler.staging.toml`
   `npx wrangler secret put PRESIDENT_EMAIL --config wrangler.staging.toml`
   Do not set `REGISTRY_API_URL` / `REGISTRY_API_TOKEN` in staging unless a staging registry exists.
4. **Review then apply migrations to staging only.**
   `npx wrangler d1 migrations list DB --remote --config wrangler.staging.toml`
   `npx wrangler d1 migrations apply DB --remote --config wrangler.staging.toml`
   Expected: 0001, 0003, 0010, 0011. Numbers 0002, 0004 and 0005 are reserved for the application-inbox PR (#12) and are not in this branch.
5. **Deploy.** The first deploy creates the custom-domain DNS record for the staging hostname (a DNS change; approve it first).
   `npx wrangler deploy --config wrangler.staging.toml`
6. **Verify** with the checklist in `09-STAGING-E2E-CHECKLIST.md`.

Already verified locally without deploying: `wrangler deploy --dry-run --config wrangler.staging.toml` bundles and binds only the staging D1 and `APP_ENV=staging`, and all migrations apply in order to a throwaway local D1.

## Rollback

- Disable the Access policy's allow rule or delete the custom-domain route to take staging offline.
- `npx wrangler rollback --config wrangler.staging.toml` restores the previous Worker version.
- D1 Time Travel can restore the staging database; the staging database holds only synthetic data and can also be deleted and recreated.
