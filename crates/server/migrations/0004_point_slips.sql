-- A point now carries what its slip asks, as JSON in `slip`. Points from
-- before keep their old kind in `legacy_kind`, which the server reads
-- through `Request::from_legacy_kind`; their status marks are dropped,
-- because outcomes come from the acta.
CREATE TABLE points (
    id          INTEGER PRIMARY KEY,
    meeting_id  INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    section     TEXT NOT NULL,
    title       TEXT NOT NULL,
    presenter   TEXT,
    legacy_kind TEXT,
    slip        TEXT,
    CHECK ((legacy_kind IS NULL) <> (slip IS NULL))
);

INSERT INTO points (id, meeting_id, section, title, presenter, legacy_kind)
SELECT id, meeting_id, section, title, presenter, kind FROM items;

DROP TABLE items;
ALTER TABLE points RENAME TO items;
CREATE INDEX items_by_meeting ON items (meeting_id, id);
