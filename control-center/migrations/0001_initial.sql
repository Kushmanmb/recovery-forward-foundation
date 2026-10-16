PRAGMA foreign_keys = ON;

CREATE TABLE members (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('President', 'VicePresident', 'Secretary', 'Treasurer', 'BoardMember')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  created_at INTEGER NOT NULL,
  policy_ack_at INTEGER
);

CREATE TABLE sessions (
  session_hash TEXT PRIMARY KEY,
  member_email TEXT NOT NULL REFERENCES members(email),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX sessions_member_idx ON sessions (member_email, revoked_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;
