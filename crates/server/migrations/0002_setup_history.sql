-- The church's setup is its history, one row per step, never edited and
-- never deleted. The current setup is not stored anywhere. The server
-- replays it from the bundled manual and these rows.
CREATE TABLE setup_history (
    -- 1, 2, 3 ... without gaps. Row 1 is the initial setup. The server
    -- inserts id = latest + 1 only while latest is still the last row.
    id          INTEGER PRIMARY KEY CHECK (id >= 1),
    -- The vote behind the row: the body, the day it voted, its minute (acta).
    -- NULL on the initial setup only.
    body        TEXT,
    voted_on    TEXT,
    minute      TEXT,
    -- The domain's `Change`, as JSON.
    change      TEXT NOT NULL CHECK (json_valid(change)),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((id = 1) = (body IS NULL)),
    CHECK ((body IS NULL) = (voted_on IS NULL)),
    CHECK (body IS NOT NULL OR minute IS NULL)
);

CREATE TRIGGER setup_history_is_append_only_on_update BEFORE UPDATE ON setup_history
BEGIN
    SELECT RAISE(ABORT, 'the setup history is append-only');
END;

CREATE TRIGGER setup_history_is_append_only_on_delete BEFORE DELETE ON setup_history
BEGIN
    SELECT RAISE(ABORT, 'the setup history is append-only');
END;
