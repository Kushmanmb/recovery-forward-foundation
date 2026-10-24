-- Board governance: directors, verified rules, meetings, proposals, votes, resolutions.
-- Numbered 0010+ to stay clear of 0002/0004/0005 (application inbox, PR #12).
-- Immutability is enforced in the database as defense in depth; the Worker also checks every rule.

CREATE TABLE board_directors (
  email TEXT PRIMARY KEY REFERENCES members(email),
  seat_title TEXT NOT NULL CHECK (length(seat_title) BETWEEN 1 AND 100),
  seated_at INTEGER NOT NULL,
  seated_by TEXT NOT NULL,
  ended_at INTEGER,
  ended_by TEXT
);

-- Rules transcribed from the adopted bylaws and applicable Indiana law and attested by the President.
-- Rows are append-only; the highest id is the effective rule set.
CREATE TABLE governance_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  director_count INTEGER NOT NULL CHECK (director_count > 0),
  quorum INTEGER NOT NULL CHECK (quorum > 0 AND quorum <= director_count),
  approval_rule TEXT NOT NULL CHECK (approval_rule IN ('majority_votes_cast', 'majority_present', 'majority_all_directors', 'two_thirds_present')),
  notice_days INTEGER NOT NULL CHECK (notice_days >= 0),
  written_consent_permitted INTEGER NOT NULL DEFAULT 0 CHECK (written_consent_permitted IN (0, 1)),
  source_document TEXT NOT NULL CHECK (length(source_document) BETWEEN 1 AND 300),
  statutory_basis TEXT NOT NULL CHECK (length(statutory_basis) BETWEEN 1 AND 300),
  verified_by TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);
CREATE TRIGGER governance_rules_no_update BEFORE UPDATE ON governance_rules BEGIN SELECT RAISE(ABORT, 'governance rules are append-only'); END;
CREATE TRIGGER governance_rules_no_delete BEFORE DELETE ON governance_rules BEGIN SELECT RAISE(ABORT, 'governance rules are append-only'); END;

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  meeting_type TEXT NOT NULL CHECK (meeting_type IN ('regular', 'special', 'annual')),
  scheduled_at INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_session', 'adjourned')),
  notice_sent_at INTEGER,
  notice_recorded_by TEXT,
  started_at INTEGER,
  adjourned_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX meetings_schedule_idx ON meetings (scheduled_at);
CREATE TRIGGER meetings_no_delete BEFORE DELETE ON meetings BEGIN SELECT RAISE(ABORT, 'meetings are retained'); END;
CREATE TRIGGER meetings_status_forward_only BEFORE UPDATE OF status ON meetings
WHEN NOT (OLD.status = NEW.status OR (OLD.status = 'scheduled' AND NEW.status = 'in_session') OR (OLD.status = 'in_session' AND NEW.status = 'adjourned'))
BEGIN SELECT RAISE(ABORT, 'invalid meeting status change'); END;

CREATE TABLE agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX agenda_items_meeting_idx ON agenda_items (meeting_id, position);
CREATE TRIGGER agenda_items_no_delete BEFORE DELETE ON agenda_items BEGIN SELECT RAISE(ABORT, 'agenda items are retained'); END;

CREATE TABLE meeting_attendance (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  director_email TEXT NOT NULL REFERENCES board_directors(email),
  checked_in_at INTEGER NOT NULL,
  recorded_by TEXT NOT NULL,
  PRIMARY KEY (meeting_id, director_email)
);
CREATE TRIGGER meeting_attendance_no_update BEFORE UPDATE ON meeting_attendance BEGIN SELECT RAISE(ABORT, 'attendance is append-only'); END;
CREATE TRIGGER meeting_attendance_no_delete BEFORE DELETE ON meeting_attendance BEGIN SELECT RAISE(ABORT, 'attendance is append-only'); END;

CREATE TABLE meeting_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 50000),
  drafted_by TEXT NOT NULL,
  drafted_at INTEGER NOT NULL,
  approved_by TEXT,
  approved_at INTEGER,
  UNIQUE (meeting_id, version)
);
CREATE TRIGGER meeting_minutes_frozen BEFORE UPDATE ON meeting_minutes
WHEN OLD.approved_at IS NOT NULL OR NEW.content != OLD.content OR NEW.drafted_by != OLD.drafted_by OR NEW.version != OLD.version OR NEW.meeting_id != OLD.meeting_id OR NEW.approved_by = OLD.drafted_by
BEGIN SELECT RAISE(ABORT, 'minutes are immutable; approval requires a different approver'); END;
CREATE TRIGGER meeting_minutes_no_delete BEFORE DELETE ON meeting_minutes BEGIN SELECT RAISE(ABORT, 'minutes are retained'); END;

CREATE TABLE proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  category TEXT NOT NULL CHECK (category IN ('policy', 'budget', 'grant', 'personnel', 'bylaws', 'other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'ready', 'voting', 'passed', 'failed', 'finalized', 'archived')),
  prior_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  author_email TEXT NOT NULL REFERENCES members(email),
  meeting_id INTEGER REFERENCES meetings(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  review_note TEXT,
  voting_opened_by TEXT,
  voting_opened_at INTEGER,
  voting_closed_by TEXT,
  voting_closed_at INTEGER,
  result_json TEXT,
  rules_id INTEGER REFERENCES governance_rules(id),
  archived_by TEXT,
  archived_at INTEGER,
  archive_reason TEXT
);
CREATE INDEX proposals_status_idx ON proposals (status, updated_at);
CREATE INDEX proposals_meeting_idx ON proposals (meeting_id);
CREATE TRIGGER proposals_no_delete BEFORE DELETE ON proposals BEGIN SELECT RAISE(ABORT, 'proposals are retained'); END;
CREATE TRIGGER proposals_content_frozen BEFORE UPDATE ON proposals
WHEN OLD.status != 'draft' AND (NEW.title != OLD.title OR NEW.body != OLD.body OR NEW.category != OLD.category OR NEW.author_email != OLD.author_email)
BEGIN SELECT RAISE(ABORT, 'only drafts can be edited'); END;
CREATE TRIGGER proposals_status_flow BEFORE UPDATE OF status ON proposals
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'draft' AND NEW.status IN ('submitted', 'archived')) OR
  (OLD.status = 'submitted' AND NEW.status IN ('draft', 'ready', 'archived')) OR
  (OLD.status = 'ready' AND NEW.status IN ('voting', 'archived')) OR
  (OLD.status = 'voting' AND NEW.status IN ('passed', 'failed')) OR
  (OLD.status = 'passed' AND NEW.status = 'finalized') OR
  (OLD.status IN ('failed', 'finalized') AND NEW.status = 'archived'))
BEGIN SELECT RAISE(ABORT, 'invalid proposal status change'); END;
CREATE TRIGGER proposals_archived_final BEFORE UPDATE ON proposals WHEN OLD.status = 'archived' BEGIN SELECT RAISE(ABORT, 'archived proposals are read-only'); END;

CREATE TABLE proposal_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  edited_at INTEGER NOT NULL,
  UNIQUE (proposal_id, version)
);
CREATE TRIGGER proposal_revisions_no_update BEFORE UPDATE ON proposal_revisions BEGIN SELECT RAISE(ABORT, 'revisions are append-only'); END;
CREATE TRIGGER proposal_revisions_no_delete BEFORE DELETE ON proposal_revisions BEGIN SELECT RAISE(ABORT, 'revisions are append-only'); END;

CREATE TABLE proposal_recusals (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  director_email TEXT NOT NULL REFERENCES board_directors(email),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  declared_by TEXT NOT NULL,
  declared_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, director_email)
);
CREATE TRIGGER proposal_recusals_no_late BEFORE INSERT ON proposal_recusals
WHEN EXISTS (SELECT 1 FROM votes WHERE proposal_id = NEW.proposal_id AND director_email = NEW.director_email)
 OR NOT EXISTS (SELECT 1 FROM proposals WHERE id = NEW.proposal_id AND status IN ('ready', 'voting'))
BEGIN SELECT RAISE(ABORT, 'recusal not allowed after a vote or outside an open proposal'); END;
CREATE TRIGGER proposal_recusals_no_update BEFORE UPDATE ON proposal_recusals BEGIN SELECT RAISE(ABORT, 'recusals are append-only'); END;
CREATE TRIGGER proposal_recusals_no_delete BEFORE DELETE ON proposal_recusals BEGIN SELECT RAISE(ABORT, 'recusals are append-only'); END;

-- One row per director per motion; PRIMARY KEY enforces a single recorded vote.
CREATE TABLE votes (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  director_email TEXT NOT NULL REFERENCES board_directors(email),
  choice TEXT NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
  cast_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, director_email)
);
CREATE TRIGGER votes_eligibility BEFORE INSERT ON votes
BEGIN
  SELECT RAISE(ABORT, 'proposal is not open for voting')
    WHERE NOT EXISTS (SELECT 1 FROM proposals WHERE id = NEW.proposal_id AND status = 'voting');
  SELECT RAISE(ABORT, 'not an eligible director')
    WHERE NOT EXISTS (SELECT 1 FROM board_directors d JOIN members m ON m.email = d.email
      WHERE d.email = NEW.director_email AND d.ended_at IS NULL AND m.status = 'active');
  SELECT RAISE(ABORT, 'director is recused')
    WHERE EXISTS (SELECT 1 FROM proposal_recusals WHERE proposal_id = NEW.proposal_id AND director_email = NEW.director_email);
  SELECT RAISE(ABORT, 'director is not present at the meeting')
    WHERE NOT EXISTS (SELECT 1 FROM proposals p JOIN meetings mt ON mt.id = p.meeting_id AND mt.status = 'in_session'
      JOIN meeting_attendance a ON a.meeting_id = p.meeting_id AND a.director_email = NEW.director_email WHERE p.id = NEW.proposal_id);
END;
CREATE TRIGGER votes_no_update BEFORE UPDATE ON votes BEGIN SELECT RAISE(ABORT, 'votes are final'); END;
CREATE TRIGGER votes_no_delete BEFORE DELETE ON votes BEGIN SELECT RAISE(ABORT, 'votes are final'); END;

CREATE TABLE resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  proposal_id INTEGER NOT NULL UNIQUE REFERENCES proposals(id),
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tally_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  rules_id INTEGER NOT NULL REFERENCES governance_rules(id),
  content_hash TEXT NOT NULL,
  finalized_by TEXT NOT NULL,
  finalized_at INTEGER NOT NULL
);
CREATE TRIGGER resolutions_require_passed BEFORE INSERT ON resolutions
WHEN NOT EXISTS (SELECT 1 FROM proposals WHERE id = NEW.proposal_id AND status = 'passed')
BEGIN SELECT RAISE(ABORT, 'only a passed proposal can become a resolution'); END;
CREATE TRIGGER resolutions_no_update BEFORE UPDATE ON resolutions BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
CREATE TRIGGER resolutions_no_delete BEFORE DELETE ON resolutions BEGIN SELECT RAISE(ABORT, 'resolutions are immutable'); END;
