-- Binds each motion to the rule set recorded when voting opened. Numbered after 0010 and clear of PR #12 (0004, 0005).

CREATE TRIGGER proposals_rules_locked BEFORE UPDATE OF rules_id ON proposals
WHEN OLD.rules_id IS NOT NULL AND NEW.rules_id IS NOT OLD.rules_id
BEGIN SELECT RAISE(ABORT, 'rule set is fixed once voting opens'); END;

CREATE TRIGGER proposals_voting_requires_rules BEFORE UPDATE OF status ON proposals
WHEN NEW.status = 'voting' AND NEW.rules_id IS NULL
BEGIN SELECT RAISE(ABORT, 'voting requires a recorded rule set'); END;

CREATE TRIGGER resolutions_rules_match BEFORE INSERT ON resolutions
WHEN NOT EXISTS (SELECT 1 FROM proposals WHERE id = NEW.proposal_id AND rules_id = NEW.rules_id)
BEGIN SELECT RAISE(ABORT, 'resolution must use the rule set recorded at voting'); END;
