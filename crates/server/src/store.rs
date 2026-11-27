//! Meetings, agenda items, the church setup's history and the sessions of
//! those signed in, in SQLite. Enums are stored as their serde names so the
//! database reads the same as the API.

use std::{fmt, str::FromStr};

use domain::access::Person;
use domain::agenda::{AgendaItem, ItemId, ItemStatus, Meeting, MeetingId, MeetingState, NewItem, NewMeeting};
use domain::catalog::AgendaSection;
use domain::setup::{Approval, Change, Entry, EntryId, NewEntry, Setup, SetupError, Vote};
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
};

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

pub type Result<T> = std::result::Result<T, sqlx::Error>;

/// Why `seed` or `record` wrote nothing.
#[derive(Debug)]
pub enum RecordError {
    /// The domain refused the entry.
    Rejected(SetupError),
    Storage(sqlx::Error),
}

impl From<SetupError> for RecordError {
    fn from(e: SetupError) -> Self {
        Self::Rejected(e)
    }
}

impl From<sqlx::Error> for RecordError {
    fn from(e: sqlx::Error) -> Self {
        Self::Storage(e)
    }
}

impl fmt::Display for RecordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(e) => e.fmt(f),
            Self::Storage(e) => e.fmt(f),
        }
    }
}

/// A browser's sign-in as WorkOS vouched for it: who signed in, and
/// nothing about what they may do.
#[derive(Debug)]
pub struct Session {
    pub workos_user: String,
    /// Verified by WorkOS.
    pub email: String,
    pub name: String,
    /// The `sid` of WorkOS's access token, so logout can end the WorkOS session too.
    pub workos_session: String,
}

/// Sessions are kept by the SHA-256 of their token, so a copy of the
/// database signs nobody in.
fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn name<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => s,
        other => unreachable!("stored enums serialize as strings, got {other:?}"),
    }
}

fn parse<T: DeserializeOwned>(text: String) -> Result<T> {
    serde_json::from_value(serde_json::Value::String(text)).map_err(|e| sqlx::Error::Decode(e.into()))
}

fn item_from(row: &SqliteRow) -> Result<AgendaItem> {
    Ok(AgendaItem {
        id: ItemId(row.try_get("id")?),
        section: domain::agenda::SectionId(row.try_get("section")?),
        title: row.try_get("title")?,
        kind: parse(row.try_get("kind")?)?,
        status: parse(row.try_get("status")?)?,
        presenter: row.try_get("presenter")?,
    })
}

fn entry_from(row: &SqliteRow) -> Result<Entry> {
    let approval = match row.try_get::<Option<String>, _>("body")? {
        None => Approval::Initial,
        Some(body) => Approval::Vote(Vote { body: parse(body)?, date: row.try_get("voted_on")?, minute: row.try_get("minute")? }),
    };
    Ok(Entry {
        id: EntryId(row.try_get("id")?),
        approval,
        change: serde_json::from_str(row.try_get("change")?).map_err(|e| sqlx::Error::Decode(e.into()))?,
        recorded_at: row.try_get("recorded_at")?,
    })
}

impl Store {
    /// Opens the database at `url`, creating it if needed, and migrates it.
    pub async fn open(url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(url)?.create_if_missing(true).foreign_keys(true);
        // An in-memory database exists per connection, so tests use one.
        let max = if url.contains(":memory:") { 1 } else { 4 };
        let pool = SqlitePoolOptions::new().max_connections(max).connect_with(options).await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    /// Every entry of the setup history, oldest first. Plain rows with no
    /// replay, so it answers even for a history that would not replay.
    pub async fn history(&self) -> Result<Vec<Entry>> {
        sqlx::query("SELECT id, body, voted_on, minute, change, recorded_at FROM setup_history ORDER BY id")
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(entry_from)
            .collect()
    }

    /// The church's setup, replayed from its history. None until it is
    /// seeded. A history that does not replay is a decode error, like any
    /// stored value this build cannot read.
    pub async fn setup(&self) -> Result<Option<Setup>> {
        match Setup::replay(&self.history().await?) {
            Ok(setup) => Ok(Some(setup)),
            Err(SetupError::NoSetup) => Ok(None),
            Err(e) => Err(sqlx::Error::Decode(format!("the stored setup does not replay: {e}").into())),
        }
    }

    /// Records the initial setup. False when the database already has one,
    /// so seeding twice, or two servers starting at once, converge.
    pub async fn seed(&self, initial: &Change) -> std::result::Result<bool, RecordError> {
        Setup::initial(initial)?;
        Ok(self.insert(EntryId(1), &Approval::Initial, initial).await?.is_some())
    }

    /// Records a vote, the only way the history grows after the seed. It
    /// replays the history, lets the domain accept or refuse the vote, and
    /// appends it in one call, so no caller can append an unchecked change.
    pub async fn record(&self, new: &NewEntry) -> std::result::Result<Entry, RecordError> {
        let setup = self.setup().await?.ok_or(SetupError::NoSetup)?;
        setup.apply(new)?;
        self.insert(EntryId(new.after.0 + 1), &Approval::Vote(new.vote.clone()), &new.change)
            .await?
            .ok_or(RecordError::Rejected(SetupError::Stale))
    }

    /// Inserts entry `id` only while the history still ends at `id - 1`. One
    /// statement, so the check and the write cannot be separated. None when
    /// the history no longer ends there.
    async fn insert(&self, id: EntryId, approval: &Approval, change: &Change) -> Result<Option<Entry>> {
        let (body, date, minute) = match approval {
            Approval::Initial => (None, None, None),
            Approval::Vote(vote) => (Some(name(&vote.body)), Some(vote.date.as_str()), vote.minute.as_deref()),
        };
        let row = sqlx::query(
            "INSERT INTO setup_history (id, body, voted_on, minute, change)
             SELECT ?, ?, ?, ?, ? WHERE (SELECT COALESCE(MAX(id), 0) FROM setup_history) = ?
             RETURNING recorded_at",
        )
        .bind(id.0)
        .bind(body)
        .bind(date)
        .bind(minute)
        .bind(serde_json::to_string(change).expect("a change serializes"))
        .bind(id.0 - 1)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| Ok(Entry { id, approval: approval.clone(), change: change.clone(), recorded_at: row.try_get("recorded_at")? }))
            .transpose()
    }

    pub async fn meetings(&self) -> Result<Vec<Meeting>> {
        let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM meetings ORDER BY date DESC, id DESC")
            .fetch_all(&self.pool)
            .await?;
        let mut meetings = Vec::with_capacity(ids.len());
        for id in ids {
            meetings.extend(self.meeting(MeetingId(id)).await?);
        }
        Ok(meetings)
    }

    pub async fn meeting(&self, id: MeetingId) -> Result<Option<Meeting>> {
        let Some(row) = sqlx::query("SELECT id, date, kind, state, sections FROM meetings WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let sections: Vec<AgendaSection> = serde_json::from_str(row.try_get("sections")?)
            .map_err(|e| sqlx::Error::Decode(e.into()))?;
        let items = sqlx::query("SELECT * FROM items WHERE meeting_id = ? ORDER BY id")
            .bind(id.0)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(item_from)
            .collect::<Result<_>>()?;
        Ok(Some(Meeting {
            id,
            date: row.try_get("date")?,
            kind: parse(row.try_get("kind")?)?,
            state: parse(row.try_get("state")?)?,
            sections,
            items,
        }))
    }

    pub async fn create_meeting(&self, new: &NewMeeting, sections: &[AgendaSection]) -> Result<MeetingId> {
        let sections = serde_json::to_string(sections).expect("sections serialize");
        let id = sqlx::query("INSERT INTO meetings (date, kind, state, sections) VALUES (?, ?, ?, ?)")
            .bind(&new.date)
            .bind(name(&new.kind))
            .bind(name(&MeetingState::Draft))
            .bind(sections)
            .execute(&self.pool)
            .await?
            .last_insert_rowid();
        Ok(MeetingId(id))
    }

    /// Moves the meeting from `from` to `to`. False when another request
    /// changed its state first.
    pub async fn set_state(&self, id: MeetingId, from: MeetingState, to: MeetingState) -> Result<bool> {
        let done = sqlx::query("UPDATE meetings SET state = ? WHERE id = ? AND state = ?")
            .bind(name(&to))
            .bind(id.0)
            .bind(name(&from))
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Adds an item only while the meeting is still a draft. None when the
    /// agenda closed in the meantime.
    pub async fn add_item(&self, meeting: MeetingId, item: &NewItem) -> Result<Option<ItemId>> {
        let done = sqlx::query(
            "INSERT INTO items (meeting_id, section, title, kind, status, presenter)
             SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM meetings WHERE id = ? AND state = ?)",
        )
        .bind(meeting.0)
        .bind(&item.section.0)
        .bind(item.title.trim())
        .bind(name(&item.kind))
        .bind(name(&ItemStatus::Proposed))
        .bind(item.presenter.as_deref().map(str::trim).filter(|p| !p.is_empty()))
        .bind(meeting.0)
        .bind(name(&MeetingState::Draft))
        .execute(&self.pool)
        .await?;
        Ok((done.rows_affected() == 1).then(|| ItemId(done.last_insert_rowid())))
    }

    pub async fn set_item_status(&self, meeting: MeetingId, item: ItemId, status: ItemStatus) -> Result<bool> {
        let done = sqlx::query("UPDATE items SET status = ? WHERE id = ? AND meeting_id = ?")
            .bind(name(&status))
            .bind(item.0)
            .bind(meeting.0)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Removes an item while the meeting is still a draft.
    pub async fn remove_item(&self, meeting: MeetingId, item: ItemId) -> Result<bool> {
        let done = sqlx::query(
            "DELETE FROM items WHERE id = ? AND meeting_id = ?
             AND EXISTS (SELECT 1 FROM meetings WHERE id = ? AND state = ?)",
        )
        .bind(item.0)
        .bind(meeting.0)
        .bind(meeting.0)
        .bind(name(&MeetingState::Draft))
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Keeps `session` under `token` until `expires_at`, and deletes every
    /// session expired at `now`, so the table holds only live ones without
    /// a background task.
    pub async fn open_session(&self, token: &str, session: &Session, now: i64, expires_at: i64) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE expires_at <= ?").bind(now).execute(&self.pool).await?;
        sqlx::query(
            "INSERT INTO sessions (token_hash, workos_user, email, name, workos_session, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(token_hash(token))
        .bind(&session.workos_user)
        .bind(&session.email)
        .bind(&session.name)
        .bind(&session.workos_session)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Who is signed in under `token`, if that session is live at `now`.
    pub async fn signed_in(&self, token: &str, now: i64) -> Result<Option<Person>> {
        let row = sqlx::query("SELECT email, name FROM sessions WHERE token_hash = ? AND expires_at > ?")
            .bind(token_hash(token))
            .bind(now)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| Ok(Person { email: row.try_get("email")?, name: row.try_get("name")? })).transpose()
    }

    /// Ends the session `token` names and returns its WorkOS session id.
    /// None when it had already ended, so signing out twice is harmless.
    pub async fn close_session(&self, token: &str) -> Result<Option<String>> {
        sqlx::query_scalar("DELETE FROM sessions WHERE token_hash = ? RETURNING workos_session")
            .bind(token_hash(token))
            .fetch_optional(&self.pool)
            .await
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A database file of its own for one test, removed when dropped.
    pub struct TempDatabase(std::path::PathBuf);

    impl TempDatabase {
        pub fn new(test: &str) -> Self {
            Self(std::env::temp_dir().join(format!("mayordomo-{test}-{}.db", std::process::id())))
        }

        pub fn url(&self) -> String {
            format!("sqlite://{}", self.0.display())
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            for suffix in ["", "-journal", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
            }
        }
    }

    fn church(name: &str) -> Change {
        Change { church: Some(name.into()), ..Change::default() }
    }

    fn session(email: &str) -> Session {
        Session {
            workos_user: format!("user_for_{email}"),
            email: email.into(),
            name: "Ana Rojas".into(),
            workos_session: format!("session_for_{email}"),
        }
    }

    async fn emails_signed_in(store: &Store, tokens: &[&str], now: i64) -> Vec<Option<String>> {
        let mut emails = Vec::new();
        for token in tokens {
            emails.push(store.signed_in(token, now).await.unwrap().map(|person| person.email));
        }
        emails
    }

    #[tokio::test]
    async fn a_session_is_kept_by_the_hash_of_its_token_until_it_expires() {
        let store = Store::open("sqlite::memory:").await.unwrap();
        store.open_session("token-a", &session("ana@example.org"), 100, 200).await.unwrap();
        assert_eq!(emails_signed_in(&store, &["token-a", "token-b"], 199).await, [Some("ana@example.org".into()), None]);
        assert_eq!(emails_signed_in(&store, &["token-a"], 200).await, [None], "it ends at expires_at");
        let kept: Vec<u8> = sqlx::query_scalar("SELECT token_hash FROM sessions").fetch_one(&store.pool).await.unwrap();
        assert_eq!(kept, Sha256::digest(b"token-a").to_vec());
    }

    #[tokio::test]
    async fn closing_a_session_twice_returns_its_workos_session_once() {
        let store = Store::open("sqlite::memory:").await.unwrap();
        store.open_session("token-a", &session("ana@example.org"), 100, 200).await.unwrap();
        assert_eq!(store.close_session("token-a").await.unwrap().as_deref(), Some("session_for_ana@example.org"));
        assert_eq!(store.close_session("token-a").await.unwrap(), None);
        assert_eq!(emails_signed_in(&store, &["token-a"], 150).await, [None]);
    }

    #[tokio::test]
    async fn opening_a_session_deletes_the_expired_ones() {
        let store = Store::open("sqlite::memory:").await.unwrap();
        store.open_session("expired", &session("ana@example.org"), 100, 200).await.unwrap();
        store.open_session("live", &session("luis@example.org"), 100, 900).await.unwrap();
        store.open_session("new", &session("ana@example.org"), 300, 1_000).await.unwrap();
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions").fetch_one(&store.pool).await.unwrap();
        assert_eq!(rows, 2);
    }

    #[tokio::test]
    async fn two_votes_on_the_same_entry_record_exactly_one() {
        let database = TempDatabase::new("vote-race");
        let store = Store::open(&database.url()).await.unwrap();
        store.seed(&church("Iglesia")).await.unwrap();
        let rename = |name: &str| NewEntry {
            after: EntryId(1),
            vote: Vote { body: domain::setup::VotingBody::BusinessMeeting, date: "2026-04-11".into(), minute: None },
            change: church(name),
        };
        let (central, north) = (rename("Iglesia Central"), rename("Iglesia Norte"));
        // Two open connections let both votes read entry 1 before either
        // writes. With one, the second vote would only see the first one's row.
        let (warm, _) = tokio::join!(store.history(), store.history());
        warm.unwrap();
        let (a, b) = tokio::join!(store.record(&central), store.record(&north));
        assert_eq!([a.is_ok(), b.is_ok()].iter().filter(|ok| **ok).count(), 1, "{a:?} {b:?}");
        assert!(matches!(a.err().or(b.err()), Some(RecordError::Rejected(SetupError::Stale))));
        assert_eq!(store.history().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn the_setup_history_cannot_be_rewritten() {
        let store = Store::open("sqlite::memory:").await.unwrap();
        let refused = |sql: &'static str| {
            let pool = store.pool.clone();
            async move { sqlx::query(sql).execute(&pool).await.expect_err(sql).to_string() }
        };
        let err = refused("INSERT INTO setup_history (id, minute, change) VALUES (1, 'Acta 1', '{}')").await;
        assert!(err.contains("CHECK"), "an initial setup has no minute: {err}");

        assert!(store.seed(&church("Iglesia")).await.unwrap());
        assert!(!store.seed(&church("Otra")).await.unwrap(), "a second seed writes nothing");
        let err = refused("INSERT INTO setup_history (id, change) VALUES (2, '{}')").await;
        assert!(err.contains("CHECK"), "every later entry has a vote: {err}");
        for sql in ["UPDATE setup_history SET change = '{}'", "DELETE FROM setup_history"] {
            let err = refused(sql).await;
            assert!(err.contains("the setup history is append-only"), "{sql}: {err}");
        }

        let history = store.history().await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].change.church.as_deref(), Some("Iglesia"));
    }
}
