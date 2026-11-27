use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::acta::ActaNumber;
use crate::catalog::{AgendaSection, OfficeId};
use crate::schedule::{PlaceId, ServiceTime};
use crate::setup::Setup;
use crate::{Balboas, Date, ScanId, Source};

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

/// The days before a meeting by which its points are due ("3 días antes de la junta").
const DAYS_TO_CLOSE: i64 = 3;

/// A church board meeting. The board meets at least monthly (p. 167).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Meeting {
    pub id: MeetingId,
    pub date: Date,
    pub kind: MeetingKind,
    pub state: MeetingState,
    pub time: Option<ServiceTime>,
    pub place: Option<PlaceRef>,
    /// Given when the meeting is called, from `ActaNumber::next`.
    pub number: Option<ActaNumber>,
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

/// A point on the agenda, as its slip asked it. What the board decided is
/// in the acta, never here.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgendaItem {
    pub id: ItemId,
    /// Where the first elder placed the point; the slip does not say.
    pub section: SectionId,
    /// The desk the decision goes back to. None for points entered before
    /// points named their office, and for the pastor's own points.
    pub office: Option<OfficeId>,
    pub title: String,
    pub presenter: Option<String>,
    pub request: Request,
    pub explanation: String,
    /// The day the first elder received the slip.
    pub received_on: Option<Date>,
    /// Pages sent with the point, such as quotes. The slip's own pages are in `source`.
    pub scans: Vec<ScanId>,
    /// Only when the point "convoca a los hermanos".
    pub activity: Option<Activity>,
    /// None for points entered before the app kept who entered them.
    pub source: Option<Source>,
}

/// What a point asks the board to do ("Qué le pide a la junta").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Request {
    AcceptReport,
    ApprovePlan,
    /// Quotes go with it, as the point's `scans`.
    ApproveExpense { amount: Option<Balboas> },
    /// The board recommends and the church decides (p. 83).
    RecommendToChurch,
    OtherDecision,
    /// Only so the board knows; not voted.
    Inform,
}

impl Request {
    /// The request a point stored before requests replaced kinds asked.
    /// A vote said nothing of what it decided, so it becomes another decision.
    pub fn from_legacy_kind(kind: &str) -> Option<Self> {
        match kind {
            "informative" => Some(Self::Inform),
            "vote" => Some(Self::OtherDecision),
            "budget" => Some(Self::ApproveExpense { amount: None }),
            _ => None,
        }
    }
}

/// What a point that "convoca a los hermanos" calls them to: the slip's back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Activity {
    pub name: String,
    pub purpose: String,
    pub audience: String,
    /// Who is responsible and the people it needs.
    pub people_needed: String,
    /// Another department it needs, as written on the slip.
    pub other_office: Option<String>,
    pub dates: ActivityDates,
    pub time: Option<ServiceTime>,
    pub place: Option<PlaceRef>,
    pub origin: Origin,
    pub budget: Option<Balboas>,
}

/// One day, a run of days, or several separate days. A run never ends
/// before it starts and a list is never empty: both are refused when read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ActivityDates {
    Day(Date),
    Range { from: Date, to: Date },
    List(Vec<Date>),
}

impl ActivityDates {
    pub fn range(from: Date, to: Date) -> Result<Self, String> {
        if to < from {
            return Err(format!("the activity ends on {to}, before it starts on {from}"));
        }
        Ok(Self::Range { from, to })
    }

    pub fn list(dates: Vec<Date>) -> Result<Self, String> {
        if dates.is_empty() {
            return Err("an activity on several dates needs at least one date".into());
        }
        Ok(Self::List(dates))
    }
}

impl<'de> Deserialize<'de> for ActivityDates {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "snake_case")]
        enum Written {
            Day(Date),
            Range { from: Date, to: Date },
            List(Vec<Date>),
        }
        match Written::deserialize(deserializer)? {
            Written::Day(day) => Ok(Self::Day(day)),
            Written::Range { from, to } => Self::range(from, to),
            Written::List(dates) => Self::list(dates),
        }
        .map_err(serde::de::Error::custom)
    }
}

/// One of the church's places, or anywhere else as written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PlaceRef {
    Church(PlaceId),
    Other(String),
}

/// Where an activity comes from ("De dónde viene").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Origin {
    Local,
    /// The local field (the campo); the slip names no field.
    Campo,
    UnionOrDivision,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct NewMeeting {
    pub date: String,
    pub kind: MeetingKind,
}

/// What a point slip carries, placed in a section. Who entered it and from
/// which paper is the recording route's to say.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewItem {
    pub section: SectionId,
    pub office: Option<OfficeId>,
    pub title: String,
    pub presenter: Option<String>,
    pub request: Request,
    pub explanation: String,
    pub received_on: Option<Date>,
    pub scans: Vec<ScanId>,
    pub activity: Option<Activity>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgendaError {
    BadDate(String),
    EmptyTitle,
    UnknownSection(String),
    UnknownOffice(OfficeId),
    UnknownPlace(PlaceId),
    UnknownScan(ScanId),
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
            Self::UnknownOffice(o) => write!(f, "the church has no office {}", o.0),
            Self::UnknownPlace(p) => write!(f, "the church has no place {}", p.0),
            Self::UnknownScan(s) => write!(f, "there is no scan {}", s.0),
            Self::AgendaClosed => write!(f, "the agenda is closed; items can only be added to a draft"),
            Self::AlreadyHeld => write!(f, "the meeting was already held"),
        }
    }
}

impl NewMeeting {
    pub fn validate(&self) -> Result<Date, AgendaError> {
        Date::try_from(self.date.as_str()).map_err(|_| AgendaError::BadDate(self.date.clone()))
    }
}

impl Meeting {
    /// Refuses only what cannot be: a closed agenda, a blank title, or a
    /// section, office or place that does not exist. A late slip is accepted.
    pub fn check_new_item(&self, item: &NewItem, setup: &Setup) -> Result<(), AgendaError> {
        if self.state != MeetingState::Draft {
            return Err(AgendaError::AgendaClosed);
        }
        if item.title.trim().is_empty() {
            return Err(AgendaError::EmptyTitle);
        }
        if !self.sections.iter().any(|s| s.id == item.section) {
            return Err(AgendaError::UnknownSection(item.section.0.clone()));
        }
        if let Some(office) = item.office.as_ref().filter(|o| setup.catalog().office(o).is_none()) {
            return Err(AgendaError::UnknownOffice(office.clone()));
        }
        let place = item.activity.as_ref().and_then(|a| match &a.place {
            Some(PlaceRef::Church(id)) => Some(id),
            _ => None,
        });
        if let Some(place) = place.filter(|id| !setup.places().iter().any(|p| &p.id == *id)) {
            return Err(AgendaError::UnknownPlace(place.clone()));
        }
        Ok(())
    }

    pub fn next_state(&self) -> Result<MeetingState, AgendaError> {
        self.state.next().ok_or(AgendaError::AlreadyHeld)
    }

    /// The last day a slip is on time.
    pub fn closes_on(&self) -> Date {
        self.date.plus_days(-DAYS_TO_CLOSE)
    }

    /// Whether the slip reached the first elder after the agenda closed. A
    /// late point stays on the agenda; the first elder sees it is late.
    pub fn is_late(&self, item: &AgendaItem) -> bool {
        item.received_on.is_some_and(|received| received > self.closes_on())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::Change;

    fn day(text: &str) -> Date {
        Date::try_from(text).unwrap()
    }

    fn draft() -> Meeting {
        Meeting {
            id: MeetingId(1),
            date: day("2026-12-06"),
            kind: MeetingKind::Regular,
            state: MeetingState::Draft,
            time: None,
            place: None,
            number: None,
            sections: vec![AgendaSection { id: SectionId("finanzas".into()), title: "Finanzas".into(), page: None }],
            items: vec![],
        }
    }

    fn church() -> Setup {
        let places = serde_json::from_str(r#"[{"id":"templo","name":"Templo","kind":"own"}]"#).unwrap();
        Setup::initial(&Change { church: Some("Iglesia".into()), places: Some(places), ..Change::default() }).unwrap()
    }

    fn item(section: &str, title: &str) -> NewItem {
        NewItem {
            section: SectionId(section.into()),
            office: Some(OfficeId::from("tesorero")),
            title: title.into(),
            presenter: None,
            request: Request::AcceptReport,
            explanation: String::new(),
            received_on: None,
            scans: vec![],
            activity: None,
        }
    }

    fn stored(received_on: Option<Date>) -> AgendaItem {
        let new = item("finanzas", "Informe");
        AgendaItem {
            id: ItemId(1),
            section: new.section,
            office: new.office,
            title: new.title,
            presenter: None,
            request: new.request,
            explanation: String::new(),
            received_on,
            scans: vec![],
            activity: None,
            source: None,
        }
    }

    fn activity(place: PlaceRef) -> Activity {
        Activity {
            name: "Campamento".into(),
            purpose: String::new(),
            audience: String::new(),
            people_needed: String::new(),
            other_office: None,
            dates: ActivityDates::Day(day("2026-12-26")),
            time: None,
            place: Some(place),
            origin: Origin::Local,
            budget: None,
        }
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
        let (mut m, setup) = (draft(), church());
        assert_eq!(m.check_new_item(&item("finanzas", "Informe"), &setup), Ok(()));
        assert_eq!(m.check_new_item(&item("otra", "Informe"), &setup), Err(AgendaError::UnknownSection("otra".into())));
        assert_eq!(m.check_new_item(&item("finanzas", "  "), &setup), Err(AgendaError::EmptyTitle));
        m.state = MeetingState::Called;
        assert_eq!(m.check_new_item(&item("finanzas", "Informe"), &setup), Err(AgendaError::AgendaClosed));
    }

    #[test]
    fn a_point_names_a_known_office_and_its_activity_a_known_place() {
        let (m, setup) = (draft(), church());
        let pastors = NewItem { office: None, ..item("finanzas", "Informe") };
        assert_eq!(m.check_new_item(&pastors, &setup), Ok(()));
        let unknown = NewItem { office: Some(OfficeId::from("obispo")), ..item("finanzas", "Informe") };
        assert_eq!(m.check_new_item(&unknown, &setup), Err(AgendaError::UnknownOffice(OfficeId::from("obispo"))));
        let at = |place| NewItem { activity: Some(activity(place)), ..item("finanzas", "Campamento") };
        assert_eq!(m.check_new_item(&at(PlaceRef::Church("templo".into())), &setup), Ok(()));
        assert_eq!(m.check_new_item(&at(PlaceRef::Other("Playa de Coronado".into())), &setup), Ok(()));
        assert_eq!(m.check_new_item(&at(PlaceRef::Church("gimnasio".into())), &setup), Err(AgendaError::UnknownPlace("gimnasio".into())));
    }

    #[test]
    fn a_meeting_date_must_be_a_calendar_date() {
        let new = |date: &str| NewMeeting { date: date.into(), kind: MeetingKind::Regular };
        assert_eq!(new("2026-12-06").validate(), Ok(day("2026-12-06")));
        for bad in ["06/12/2026", "2026-1-6", "", "2026-12-06T10:00", "2026-02-30"] {
            assert!(new(bad).validate().is_err(), "{bad}");
        }
    }

    #[test]
    fn the_legacy_kinds_map_to_the_new_requests() {
        assert_eq!(Request::from_legacy_kind("informative"), Some(Request::Inform));
        assert_eq!(Request::from_legacy_kind("vote"), Some(Request::OtherDecision));
        assert_eq!(Request::from_legacy_kind("budget"), Some(Request::ApproveExpense { amount: None }));
        assert_eq!(Request::from_legacy_kind("approved"), None);
    }

    #[test]
    fn a_request_is_written_with_its_amount() {
        let expense: Request = serde_json::from_str(r#"{"approve_expense":{"amount":"480"}}"#).unwrap();
        assert_eq!(serde_json::to_string(&expense).unwrap(), r#"{"approve_expense":{"amount":"480.00"}}"#);
        assert_eq!(serde_json::to_string(&Request::Inform).unwrap(), r#""inform""#);
    }

    #[test]
    fn an_activity_runs_on_a_day_a_range_or_a_list_and_never_backwards() {
        let read = |json: &str| serde_json::from_str::<ActivityDates>(json);
        assert_eq!(read(r#"{"day":"2026-12-26"}"#).unwrap(), ActivityDates::Day(day("2026-12-26")));
        assert!(read(r#"{"range":{"from":"2026-12-26","to":"2026-12-28"}}"#).is_ok());
        assert!(read(r#"{"range":{"from":"2026-12-26","to":"2026-12-26"}}"#).is_ok(), "a one-day range");
        assert!(read(r#"{"list":["2026-12-05","2026-12-19"]}"#).is_ok());
        let backwards = read(r#"{"range":{"from":"2026-12-28","to":"2026-12-26"}}"#).unwrap_err();
        assert!(backwards.to_string().contains("before it starts"), "{backwards}");
        let empty = read(r#"{"list":[]}"#).unwrap_err();
        assert!(empty.to_string().contains("at least one date"), "{empty}");
    }

    #[test]
    fn the_agenda_closes_three_days_before_and_a_later_slip_is_late_not_refused() {
        let m = draft();
        assert_eq!(m.closes_on(), day("2026-12-03"));
        assert!(!m.is_late(&stored(Some(day("2026-12-03")))), "on the closing day");
        assert!(m.is_late(&stored(Some(day("2026-12-04")))));
        assert!(!m.is_late(&stored(None)), "no receipt date is not late");
        let late = NewItem { received_on: Some(day("2026-12-05")), ..item("finanzas", "Informe") };
        assert_eq!(m.check_new_item(&late, &church()), Ok(()));
    }
}
