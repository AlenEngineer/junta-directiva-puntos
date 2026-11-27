//! Meetings and agenda items in SQLite. Enums are stored as their serde
//! names so the database reads the same as the API.

use std::str::FromStr;

use domain::agenda::{AgendaItem, ItemId, ItemStatus, Meeting, MeetingId, MeetingState, NewItem, NewMeeting};
use domain::catalog::AgendaSection;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
};

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

pub type Result<T> = std::result::Result<T, sqlx::Error>;

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
}
