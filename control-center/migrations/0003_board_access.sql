-- 0002 is reserved for the separate application-inbox work.
CREATE TABLE board_access_invitations (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('VicePresident', 'Secretary', 'Treasurer', 'BoardMember')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  activated_at INTEGER,
  revoked_at INTEGER,
  identity_verified_at INTEGER,
  mfa_verified_at INTEGER
);
