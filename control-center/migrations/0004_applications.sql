-- Phase 1: private application inbox. Application text is sensitive; it is only
-- ever read through the Access-protected Worker (President or assigned reviewer).
CREATE TABLE applications (
  rcgi TEXT PRIMARY KEY CHECK (length(rcgi) = 17 AND rcgi LIKE 'RCGI-%'),
  recovery_stage TEXT NOT NULL,
  recovery_support TEXT NOT NULL,
  needs_json TEXT NOT NULL,
  need_description TEXT NOT NULL,
  goals TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'assigned', 'in_review', 'recommended', 'not_recommended', 'closed')),
  assigned_to TEXT REFERENCES members(email),
  assigned_by TEXT REFERENCES members(email),
  assigned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((assigned_to IS NULL) = (assigned_at IS NULL))
);

CREATE INDEX applications_status_idx ON applications (status, created_at);
CREATE INDEX applications_assignee_idx ON applications (assigned_to, status);

-- Board members the President has authorized to review assigned applications.
CREATE TABLE application_reviewers (
  member_email TEXT PRIMARY KEY REFERENCES members(email),
  authorized_by TEXT NOT NULL REFERENCES members(email),
  authorized_at INTEGER NOT NULL,
  revoked_at INTEGER
);
