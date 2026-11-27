CREATE TABLE meetings (
    id       INTEGER PRIMARY KEY,
    date     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    state    TEXT NOT NULL,
    sections TEXT NOT NULL
);

CREATE TABLE items (
    id         INTEGER PRIMARY KEY,
    meeting_id INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    section    TEXT NOT NULL,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    status     TEXT NOT NULL,
    presenter  TEXT
);

CREATE INDEX items_by_meeting ON items (meeting_id, id);
