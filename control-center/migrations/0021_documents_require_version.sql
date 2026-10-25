-- A document row must never exist without a committed version. Uploads insert the document and its
-- first version in one atomic batch, so version 0 is no longer a valid state for new rows.
-- Existing rows are untouched; documents still at version 0 stay hidden from every read path.
CREATE TRIGGER documents_no_empty_insert BEFORE INSERT ON documents
WHEN NEW.current_version < 1
BEGIN SELECT RAISE(ABORT, 'documents must be created with a version'); END;
