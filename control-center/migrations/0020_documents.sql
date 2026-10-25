-- Phase 1: private document storage metadata. File bytes live only in the private R2 binding (DOCUMENTS).
-- Numbered 0020 to stay clear of 0004-0005 (PR #12 applications) and 0010-0011 (PR #34 governance).

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL CHECK (folder IN ('board', 'finance', 'records', 'restricted')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  current_version INTEGER NOT NULL DEFAULT 0, -- 0 until the first version is committed
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_by TEXT,
  archived_at INTEGER
);
CREATE INDEX documents_folder_idx ON documents (folder, status, created_at);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  UNIQUE (document_id, version)
);

-- Version records are immutable history.
CREATE TRIGGER document_versions_no_update BEFORE UPDATE ON document_versions
BEGIN SELECT RAISE(ABORT, 'document versions are immutable'); END;
CREATE TRIGGER document_versions_no_delete BEFORE DELETE ON document_versions
BEGIN SELECT RAISE(ABORT, 'document versions are immutable'); END;
CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
BEGIN SELECT RAISE(ABORT, 'documents cannot be deleted'); END;
