use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::catalog::AgendaSection;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
/// SQLite row id; far below 2^53, so a JSON number in the browser.
#[ts(export, type = "number")]
pub struct MeetingId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
/// SQLite row id; far below 2^53, so a JSON number in the browser.
#[ts(export, type = "number")]
pub struct ItemId(pub i64);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SectionId(pub String);

/// A church board meeting. The board meets at least monthly (p. 167).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Meeting {
    pub id: MeetingId,
    /// Calendar date as `YYYY-MM-DD`.
    pub date: String,
    pub kind: MeetingKind,
    pub state: MeetingState,
    /// Copied from the catalog's board agenda when the meeting is created,
    /// so later catalog changes do not rewrite past agendas.
    pub sections: Vec<AgendaSection>,
    pub items: Vec<AgendaItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MeetingKind {
    Regular,
    /// Once a quarter the whole meeting may go to evangelism planning (p. 168).
    Evangelism,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MeetingState {
    /// Items are still being collected.
    Draft,
    /// The agenda is closed and the meeting announced.
    Called,
    Held,
}

impl MeetingState {
    pub fn next(self) -> Option<Self> {
        match self {
            Self::Draft => Some(Self::Called),
            Self::Called => Some(Self::Held),
            Self::Held => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgendaItem {
    pub id: ItemId,
    pub section: SectionId,
    pub title: String,
    pub kind: ItemKind,
    pub status: ItemStatus,
    pub presenter: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ItemKind {
    Informative,
    Vote,
    Budget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ItemStatus {
    Proposed,
    Approved,
    Discussed,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct NewMeeting {
    pub date: String,
    pub kind: MeetingKind,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct NewItem {
    pub section: SectionId,
    pub title: String,
    pub kind: ItemKind,
    pub presenter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgendaError {
    BadDate(String),
    EmptyTitle,
    UnknownSection(String),
    /// Items can only be added while the meeting is a draft.
    AgendaClosed,
    AlreadyHeld,
}

impl std::fmt::Display for AgendaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadDate(d) => write!(f, "{d} is not a YYYY-MM-DD date"),
            Self::EmptyTitle => write!(f, "an item needs a title"),
            Self::UnknownSection(s) => write!(f, "this meeting has no section {s}"),
            Self::AgendaClosed => write!(f, "the agenda is closed; items can only be added to a draft"),
            Self::AlreadyHeld => write!(f, "the meeting was already held"),
        }
    }
}

impl NewMeeting {
    pub fn validate(&self) -> Result<(), AgendaError> {
        crate::is_iso_date(&self.date).then_some(()).ok_or_else(|| AgendaError::BadDate(self.date.clone()))
    }
}

impl Meeting {
    pub fn check_new_item(&self, item: &NewItem) -> Result<(), AgendaError> {
        if self.state != MeetingState::Draft {
            return Err(AgendaError::AgendaClosed);
        }
        if item.title.trim().is_empty() {
            return Err(AgendaError::EmptyTitle);
        }
        if !self.sections.iter().any(|s| s.id == item.section) {
            return Err(AgendaError::UnknownSection(item.section.0.clone()));
        }
        Ok(())
    }

    pub fn next_state(&self) -> Result<MeetingState, AgendaError> {
        self.state.next().ok_or(AgendaError::AlreadyHeld)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> Meeting {
        Meeting {
            id: MeetingId(1),
            date: "2026-12-06".into(),
            kind: MeetingKind::Regular,
            state: MeetingState::Draft,
            sections: vec![AgendaSection { id: SectionId("finanzas".into()), title: "Finanzas".into(), page: None }],
            items: vec![],
        }
    }

    fn item(section: &str, title: &str) -> NewItem {
        NewItem { section: SectionId(section.into()), title: title.into(), kind: ItemKind::Informative, presenter: None }
    }

    #[test]
    fn a_meeting_moves_forward_and_stops_once_held() {
        let mut m = draft();
        for expected in [MeetingState::Called, MeetingState::Held] {
            m.state = m.next_state().unwrap();
            assert_eq!(m.state, expected);
        }
        assert_eq!(m.next_state(), Err(AgendaError::AlreadyHeld));
    }

    #[test]
    fn items_go_into_a_known_section_of_a_draft() {
        let mut m = draft();
        assert_eq!(m.check_new_item(&item("finanzas", "Informe")), Ok(()));
        assert_eq!(m.check_new_item(&item("otra", "Informe")), Err(AgendaError::UnknownSection("otra".into())));
        assert_eq!(m.check_new_item(&item("finanzas", "  ")), Err(AgendaError::EmptyTitle));
        m.state = MeetingState::Called;
        assert_eq!(m.check_new_item(&item("finanzas", "Informe")), Err(AgendaError::AgendaClosed));
    }

    #[test]
    fn a_meeting_date_must_look_like_a_calendar_date() {
        let new = |date: &str| NewMeeting { date: date.into(), kind: MeetingKind::Regular };
        assert!(new("2026-12-06").validate().is_ok());
        for bad in ["06/12/2026", "2026-1-6", "", "2026-12-06T10:00"] {
            assert!(new(bad).validate().is_err(), "{bad}");
        }
    }
}
