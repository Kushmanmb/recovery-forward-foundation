import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { boardAccess, acceptBoardInvitation } from '../src/board-access.js';

const president = { email: 'president@example.org', role: 'President', status: 'active' };
function setup() {
  const database = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0003_board_access.sql']) database.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  database.prepare('INSERT INTO members (email, role, status, created_at) VALUES (?, ?, ?, ?)').run(president.email, president.role, president.status, Date.now());
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        first() { return database.prepare(sql).get(...values); },
        all() { return { results: database.prepare(sql).all(...values) }; },
        run() { return database.prepare(sql).run(...values); },
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try { const results = statements.map(statement => statement.run()); database.exec('COMMIT'); return results; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  function request(path, input, origin = 'https://admin.example.org') {
    return new Request('https://admin.example.org' + path, input === undefined ? {} : {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  const env = { DB };
  return {
    database, env, request,
    call: (path, input, actor = president, origin) => boardAccess(request(path, input, origin), env, actor),
    accept: (token, email = 'secretary@example.org', extra = {}) => acceptBoardInvitation(request('/api/board/accept', { token, policyAck: true, ...extra }), env, { email }),
    async invite(email = 'secretary@example.org', role = 'Secretary') {
      const response = await boardAccess(request('/api/board/invite', { email, role }), env, president);
      assert.equal(response.status, 201); return response.json();
    },
  };
}

test('board invitation lifecycle persists hashed tokens, requires activation, revokes sessions, and records audit', async () => {
  const s = setup();
  try {
    const invite = await s.invite();
    const saved = s.database.prepare('SELECT * FROM board_access_invitations').get();
    assert.notEqual(saved.token_hash, invite.token);
    assert.match(saved.token_hash, /^[a-f0-9]{64}$/);
    assert.equal(saved.expires_at - saved.created_at, 48 * 60 * 60 * 1000);
    assert.equal(s.database.prepare('SELECT COUNT(*) AS n FROM members').get().n, 1);
    assert.equal((await s.accept(invite.token, 'wrong@example.org')).status, 400);
    assert.equal((await s.accept(invite.token, undefined, { policyAck: false })).status, 400);
    assert.equal((await s.accept(invite.token)).status, 200);
    assert.equal((await s.accept(invite.token)).status, 400);
    assert.equal(s.database.prepare("SELECT status FROM members WHERE role = 'Secretary'").get().status, 'pending');
    assert.equal((await s.call('/api/board/activate', { email: invite.email })).status, 400);
    assert.equal((await s.call('/api/board/activate', { email: invite.email, identityVerified: true, mfaVerified: true })).status, 200);
    assert.equal((await s.call('/api/board/activate', { email: invite.email, identityVerified: true, mfaVerified: true })).status, 409);
    s.database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)').run('synthetic-hash', invite.email, Date.now(), Date.now() + 10000);
    assert.equal((await s.call('/api/board/suspend', { email: invite.email, reason: '' })).status, 400);
    assert.equal((await s.call('/api/board/suspend', { email: invite.email, reason: 'Officer requested suspension' })).status, 200);
    assert.ok(s.database.prepare('SELECT revoked_at FROM sessions').get().revoked_at);
    assert.equal((await s.call('/api/board/reinstate', { email: invite.email })).status, 200);
    const roster = await (await s.call('/api/board')).json();
    assert.equal(roster.members.length, 2);
    assert.equal(JSON.stringify(roster).includes(saved.token_hash), false);
    const audit = s.database.prepare('SELECT action, detail_json FROM audit_log').all();
    for (const action of ['board_invitation_created', 'board_invitation_accepted', 'board_member_activated', 'board_member_suspended', 'board_member_reinstated', 'board_roster_read']) assert.ok(audit.some(entry => entry.action === action), action);
    assert.equal(JSON.stringify(audit).includes(invite.token), false);
    assert.equal(audit.filter(entry => entry.action === 'board_member_activated').length, 1);
  } finally { s.database.close(); }
});

test('all board administration is denied to other roles, pending Presidents, and cross-origin requests', async () => {
  const s = setup();
  try {
    for (const role of ['Secretary', 'Treasurer', 'VicePresident', 'BoardMember']) {
      for (const path of ['/api/board', '/api/board/invite', '/api/board/activate', '/api/board/suspend', '/api/board/reinstate', '/api/board/revoke']) {
        assert.equal((await s.call(path, path === '/api/board' ? undefined : { email: 'new@example.org', role: 'Secretary' }, { ...president, role })).status, 403);
      }
    }
    assert.equal((await s.call('/api/board', undefined, { ...president, status: 'pending' })).status, 403);
    assert.equal((await s.call('/api/board/invite', { email: 'new@example.org', role: 'Secretary' }, president, 'https://evil.example.org')).status, 403);
    assert.equal((await s.call('/api/board/invite', { email: 'new@example.org', role: 'President' })).status, 400);
    assert.equal((await s.call('/api/board/suspend', { email: president.email, reason: 'test' })).status, 400);
  } finally { s.database.close(); }
});

test('expired, revoked, duplicate and replaced invitations cannot bypass acceptance', async () => {
  const s = setup();
  try {
    const old = await s.invite();
    assert.equal((await s.call('/api/board/invite', { email: old.email, role: 'Secretary' })).status, 409);
    assert.equal((await s.call('/api/board/revoke', { email: old.email })).status, 200);
    assert.equal((await s.accept(old.token)).status, 400);
    const replacement = await s.invite();
    assert.notEqual(replacement.token, old.token);
    assert.equal((await s.accept(old.token)).status, 400);
    s.database.prepare('UPDATE board_access_invitations SET expires_at = 0').run();
    assert.equal((await s.accept(replacement.token)).status, 400);
    const next = await s.invite();
    assert.equal((await s.accept(next.token)).status, 200);
    assert.equal((await s.call('/api/board/revoke', { email: next.email })).status, 409);
    assert.equal((await s.call('/api/board/invite', { email: next.email, role: 'Treasurer' })).status, 409);
    assert.equal((await s.call('/api/board/reinstate', { email: next.email })).status, 409);
  } finally { s.database.close(); }
});

test('audit failure rolls back invitation creation and acceptance', async () => {
  const s = setup();
  try {
    s.database.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    await assert.rejects(s.call('/api/board/invite', { email: 'secretary@example.org', role: 'Secretary' }));
    assert.equal(s.database.prepare('SELECT COUNT(*) AS n FROM board_access_invitations').get().n, 0);
    s.database.exec('DROP TRIGGER synthetic_audit_failure');
    const invite = await s.invite();
    s.database.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    await assert.rejects(s.accept(invite.token));
    assert.equal(s.database.prepare('SELECT accepted_at FROM board_access_invitations').get().accepted_at, null);
    assert.equal(s.database.prepare('SELECT COUNT(*) AS n FROM members').get().n, 1);
  } finally { s.database.close(); }
});

test('oversized or malformed JSON is rejected before storing data', async () => {
  const s = setup();
  try {
    const response = await s.call('/api/board/invite', { email: 'x'.repeat(5000), role: 'Secretary' });
    assert.equal(response.status, 400);
    const malformed = new Request('https://admin.example.org/api/board/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal((await acceptBoardInvitation(malformed, s.env, { email: 'test@example.org' })).status, 400);
  } finally { s.database.close(); }
});
