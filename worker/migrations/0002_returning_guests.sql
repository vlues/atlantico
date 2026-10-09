-- Returning guests: how often someone has come, and whether they are here right now.
ALTER TABLE visitors ADD COLUMN visits INTEGER NOT NULL DEFAULT 1;
ALTER TABLE visitors ADD COLUMN last_seen INTEGER;   -- latest arrival; "here" for a few hours after
ALTER TABLE visitors ADD COLUMN left_at INTEGER;     -- set when the owner ends a visit early
UPDATE visitors SET last_seen = created_at;
UPDATE visitors SET visits = 1 + (length(first_name) % 4) WHERE delete_token = 'demo';
