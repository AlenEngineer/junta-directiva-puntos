-- Who is signed in: one row per sign-in, kept by this server, not by WorkOS.
-- The browser's cookie holds a random token, and the row keeps only its
-- SHA-256, so a copy of this database signs nobody in. What a person may
-- do is not here. The server reads it from the setup on every request.
CREATE TABLE sessions (
    token_hash     BLOB PRIMARY KEY CHECK (length(token_hash) = 32),
    -- Who WorkOS vouched for: its user id, the verified email and the name.
    workos_user    TEXT NOT NULL,
    email          TEXT NOT NULL,
    name           TEXT NOT NULL,
    -- The `sid` claim of WorkOS's access token, to end the WorkOS session at logout.
    workos_session TEXT NOT NULL,
    -- Unix seconds. Live while now < expires_at. Each sign-in deletes the expired rows.
    expires_at     INTEGER NOT NULL
) WITHOUT ROWID;
