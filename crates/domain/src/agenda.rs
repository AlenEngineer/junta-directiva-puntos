use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ChargeId;
use crate::catalog::AgendaSection;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MeetingId(pub u32);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SectionId(pub String);

/// A church board meeting. The board meets at least monthly (p. 167).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Meeting {
    pub id: MeetingId,
    /// The charge through which the user prepares this meeting.
    pub charge: ChargeId,
    /// Calendar date as `YYYY-MM-DD`.
    pub date: String,
    pub kind: MeetingKind,
    pub state: MeetingState,
    /// Starts from the catalog's board agenda; the church may reorder,
    /// drop or add sections.
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

#[cfg(test)]
mod tests {
    use super::MeetingState::*;

    #[test]
    fn a_meeting_moves_forward_and_stops_once_held() {
        assert_eq!(Draft.next(), Some(Called));
        assert_eq!(Called.next(), Some(Held));
        assert_eq!(Held.next(), None);
    }
}
