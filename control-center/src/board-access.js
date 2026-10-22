import { can, ROLES } from './rbac.js';

const reply = (body, status = 200) => Response.json(body, { status });
const roles = ROLES.filter(role => role !== 'President');
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const changed = result => Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;

async function hash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function body(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('invalid_request');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new Error('invalid_request'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid_request');
  return result;
}

function audit(db, actor, action, detail, now, conditional = false) {
  return db.prepare('INSERT INTO audit_log (actor_email, action, detail_json, created_at) SELECT ?, ?, ?, ?' + (conditional ? ' WHERE changes() > 0' : ''))
    .bind(actor, action, JSON.stringify(detail), now);
}

/** Called only after Access signature verification. Acceptance does not grant an active session. */
export async function acceptBoardInvitation(request, env, identity) {
  let input;
  try { input = await body(request); } catch { return reply({ error: 'invalid_request' }, 400); }
  if (input.policyAck !== true || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) {
    return reply({ error: 'invalid_invitation' }, 400);
  }
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO members (email, role, status, created_at, policy_ack_at) SELECT email, role, 'pending', ?, ? FROM board_access_invitations WHERE email = ? AND token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM members WHERE email = ?)")
      .bind(now, now, identity.email, await hash(input.token), now, identity.email),
    env.DB.prepare('UPDATE board_access_invitations SET accepted_at = ? WHERE email = ? AND changes() > 0')
      .bind(now, identity.email),
    audit(env.DB, identity.email, 'board_invitation_accepted', {}, now, true),
  ]);
  return changed(results[0]) ? reply({ ok: true, status: 'pending' }) : reply({ error: 'invalid_invitation' }, 400);
}

/** All roster reads and writes require an active President, regardless of browser controls. */
export async function boardAccess(request, env, member) {
  const url = new URL(request.url);
  if (!can(member, 'members:invite') || member.role !== 'President') {
    await audit(env.DB, member.email, 'authorization_denied', { permission: 'members:invite' }, Date.now()).run();
    return reply({ error: 'forbidden' }, 403);
  }
  if (request.method === 'GET' && url.pathname === '/api/board') {
    const { results = [] } = await env.DB.prepare(`SELECT m.email, m.role, m.status, m.policy_ack_at, i.accepted_at, i.activated_at, i.expires_at, i.revoked_at
      FROM members m LEFT JOIN board_access_invitations i ON i.email = m.email
      UNION ALL SELECT i.email, i.role, 'invited', NULL, i.accepted_at, i.activated_at, i.expires_at, i.revoked_at
      FROM board_access_invitations i WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = i.email)
      ORDER BY email`).all();
    await audit(env.DB, member.email, 'board_roster_read', {}, Date.now()).run();
    return reply({ members: results, roles });
  }
  if (request.method !== 'POST') return reply({ error: 'not_found' }, 404);
  if (request.headers.get('origin') !== url.origin) return reply({ error: 'forbidden' }, 403);
  let input;
  try { input = await body(request); } catch { return reply({ error: 'invalid_request' }, 400); }
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || !emailPattern.test(email) || email === member.email) return reply({ error: 'invalid_request' }, 400);
  const now = Date.now();
  if (url.pathname === '/api/board/invite') {
    if (!roles.includes(input.role)) return reply({ error: 'invalid_request' }, 400);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const expiresAt = now + 48 * 60 * 60 * 1000;
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO board_access_invitations (email, role, token_hash, created_at, expires_at)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = ?)
        ON CONFLICT(email) DO UPDATE SET role = excluded.role, token_hash = excluded.token_hash,
          created_at = excluded.created_at, expires_at = excluded.expires_at, revoked_at = NULL
        WHERE board_access_invitations.accepted_at IS NULL AND (board_access_invitations.revoked_at IS NOT NULL OR board_access_invitations.expires_at <= ?)`)
        .bind(email, input.role, await hash(token), now, expiresAt, email, now),
      audit(env.DB, member.email, 'board_invitation_created', { email, role: input.role }, now, true),
    ]);
    return changed(results[0]) ? reply({ email, token, expiresAt }, 201) : reply({ error: 'member_or_invitation_exists' }, 409);
  }
  const actions = {
    '/api/board/activate': ["UPDATE members SET status = 'active' WHERE email = ? AND role != 'President' AND status = 'pending' AND policy_ack_at IS NOT NULL AND EXISTS (SELECT 1 FROM board_access_invitations i WHERE i.email = members.email AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL)", 'board_member_activated'],
    '/api/board/suspend': ["UPDATE members SET status = 'suspended' WHERE email = ? AND role != 'President' AND status = 'active'", 'board_member_suspended'],
    '/api/board/reinstate': ["UPDATE members SET status = 'active' WHERE email = ? AND role != 'President' AND status = 'suspended' AND EXISTS (SELECT 1 FROM board_access_invitations i WHERE i.email = members.email AND i.activated_at IS NOT NULL AND i.identity_verified_at IS NOT NULL AND i.mfa_verified_at IS NOT NULL)", 'board_member_reinstated'],
    '/api/board/revoke': ['UPDATE board_access_invitations SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL', 'board_invitation_revoked'],
  };
  const action = actions[url.pathname];
  if (!action) return reply({ error: 'not_found' }, 404);
  if (url.pathname.endsWith('/activate') && (input.identityVerified !== true || input.mfaVerified !== true)) return reply({ error: 'verification_required' }, 400);
  if (url.pathname.endsWith('/suspend') && (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 300)) return reply({ error: 'reason_required' }, 400);
  const statements = [
    env.DB.prepare(action[0]).bind(...(url.pathname.endsWith('/revoke') ? [now, email] : [email])),
    audit(env.DB, member.email, action[1], { email, ...(input.reason ? { reason: input.reason.trim() } : {}) }, now, true),
  ];
  if (url.pathname.endsWith('/activate')) statements.push(env.DB.prepare("UPDATE board_access_invitations SET activated_at = ?, identity_verified_at = ?, mfa_verified_at = ? WHERE email = ? AND changes() > 0 AND EXISTS (SELECT 1 FROM members WHERE email = ? AND status = 'active')").bind(now, now, now, email, email));
  if (url.pathname.endsWith('/suspend')) statements.push(env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE member_email = ? AND revoked_at IS NULL AND changes() > 0 AND EXISTS (SELECT 1 FROM members WHERE email = ? AND status = 'suspended')").bind(now, email, email));
  const results = await env.DB.batch(statements);
  return changed(results[0]) ? reply({ ok: true }) : reply({ error: 'invalid_member_state' }, 409);
}
