use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::DutyId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MeetingId(pub u32);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Meeting {
    pub id: MeetingId,
    pub duty: DutyId,
    pub title: String,
    /// Calendar date as `YYYY-MM-DD`.
    pub date: String,
    pub state: MeetingState,
    pub items: Vec<AgendaItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MeetingState {
    /// Items are still being collected.
    Draft,
    /// The agenda is closed and sent out.
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
