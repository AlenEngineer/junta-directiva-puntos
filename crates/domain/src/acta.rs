//! What the board decided, as the clerk's acta records it. The acta never
//! refuses a decision: an outcome that does not fit what a point asked is
//! kept, and the point reads as asking what the outcome implies, flagged
//! for the clerk and the first elder to see.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agenda::{AgendaItem, ItemId, Meeting, MeetingId, Request};
use crate::catalog::OfficeId;
use crate::schedule::ServiceTime;
use crate::setup::{Setup, VotingBody};
use crate::{Balboas, ChargeId, Source};

/// "22/2026": one sequence per calendar year for each voting body, so
/// numbering the board's and the church's actas together later is a data choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActaNumber {
    pub body: VotingBody,
    pub year: u16,
    pub n: u32,
}

impl ActaNumber {
    /// The number after the highest `existing` one of `body` in `year`.
    pub fn next<'a>(body: VotingBody, year: u16, existing: impl IntoIterator<Item = &'a ActaNumber>) -> Self {
        let last = existing.into_iter().filter(|a| a.body == body && a.year == year).map(|a| a.n).max().unwrap_or(0);
        Self { body, year, n: last + 1 }
    }
}

impl fmt::Display for ActaNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.n, self.year)
    }
}

/// The record of one held meeting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Acta {
    pub meeting: MeetingId,
    pub number: ActaNumber,
    pub presided: Presider,
    pub started_at: Option<ServiceTime>,
    pub ended_at: Option<ServiceTime>,
    pub devotional_by: Option<String>,
    pub closing_prayer_by: Option<String>,
    /// None when the acta does not say.
    pub previous: Option<PreviousActa>,
    pub attendance: Vec<Attendance>,
    pub outcomes: Vec<ItemOutcome>,
    /// Decisions not on the agenda ("Otros acuerdos").
    pub free: Vec<FreeDecision>,
    /// A paper acta's pages are its source's scans.
    pub source: Source,
}

/// The pastor presides; the first elder when the pastor asks (p. 167).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Presider {
    Pastor,
    FirstElder,
    Other(String),
}

/// What became of the previous acta. Reading it depends on the pastor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PreviousActa {
    Approved,
    ApprovedWithChanges,
    NotRead,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Attendance {
    pub who: Attendee,
    pub presence: Presence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Attendee {
    Charge(ChargeId),
    /// Someone the setup holds no charge for, such as the district pastor.
    Named(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Presence {
    Present,
    /// By video call; counts as present (p. 168).
    Video,
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ItemOutcome {
    pub item: ItemId,
    pub outcome: Outcome,
    /// Only when they were counted.
    pub votes: Option<Votes>,
    /// Why a point was returned or postponed, or anything else written on its line.
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Votes {
    #[serde(rename = "for")]
    pub for_: u32,
    pub against: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Outcome {
    Accepted,
    Approved,
    /// Approved for a different amount than asked.
    ApprovedFor(Balboas),
    RecommendedToChurch,
    NotRecommended,
    Returned,
    Postponed,
    Received,
}

impl Outcome {
    /// Whether the acta prints this outcome for a point that asks `request`.
    /// This is the one table of which outcomes fit which request.
    pub fn fits(self, request: Request) -> bool {
        use Outcome::*;
        match request {
            Request::AcceptReport => matches!(self, Accepted | Returned | Postponed),
            Request::ApprovePlan | Request::OtherDecision => matches!(self, Approved | Returned | Postponed),
            Request::ApproveExpense { .. } => matches!(self, Approved | ApprovedFor(_) | Returned | Postponed),
            Request::RecommendToChurch => matches!(self, RecommendedToChurch | NotRecommended | Postponed),
            Request::Inform => matches!(self, Received | Postponed),
        }
    }

    /// What a point whose outcome does not fit now reads as asking. An
    /// approval says only that the board decided, not that it was a plan,
    /// so it implies another decision; so does returning a point, which the
    /// board does only to what it had to decide.
    pub fn implied_request(self) -> Request {
        match self {
            Self::Accepted => Request::AcceptReport,
            Self::Approved | Self::Returned | Self::Postponed => Request::OtherDecision,
            Self::ApprovedFor(_) => Request::ApproveExpense { amount: None },
            Self::RecommendedToChurch | Self::NotRecommended => Request::RecommendToChurch,
            Self::Received => Request::Inform,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FreeDecision {
    pub subject: String,
    pub outcome: FreeOutcome,
    pub votes: Option<Votes>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FreeOutcome {
    Approved,
    RecommendedToChurch,
    Received,
    Other(String),
}

/// Whether enough of the board was there. A church that set no quorum
/// leaves it unknown, never failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Quorum {
    Met,
    NotMet,
    Unknown,
}

/// Something in a recorded acta for the clerk and the first elder to look at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Flag {
    /// The outcome does not fit what the point asked, so acta `by` changed
    /// the point's request from `previous` to `now`.
    RequestChanged { item: ItemId, previous: Request, now: Request, by: ActaNumber },
    /// Returned or postponed with no reason written.
    NoReason { item: ItemId },
    NoQuorum { present: u32, quorum: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActaError {
    OtherMeeting { acta: MeetingId, meeting: MeetingId },
    UnknownItem(ItemId),
    UnknownCharge(ChargeId),
    EndsBeforeStart { started_at: ServiceTime, ended_at: ServiceTime },
}

impl fmt::Display for ActaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OtherMeeting { acta, meeting } => write!(f, "the acta is for meeting {}, not meeting {}", acta.0, meeting.0),
            Self::UnknownItem(item) => write!(f, "the meeting has no point {}", item.0),
            Self::UnknownCharge(charge) => write!(f, "charge {} is not held", charge.0),
            Self::EndsBeforeStart { started_at, ended_at } => write!(f, "the meeting ends at {ended_at}, before it starts at {started_at}"),
        }
    }
}

impl Acta {
    /// Refuses only what cannot be: another meeting's acta, a point or a
    /// charge that does not exist, or a meeting that ends before it starts.
    pub fn check(&self, meeting: &Meeting, setup: &Setup) -> Result<(), ActaError> {
        if self.meeting != meeting.id {
            return Err(ActaError::OtherMeeting { acta: self.meeting, meeting: meeting.id });
        }
        if let Some(o) = self.outcomes.iter().find(|o| !meeting.items.iter().any(|i| i.id == o.item)) {
            return Err(ActaError::UnknownItem(o.item));
        }
        let mut charges = self.attendance.iter().filter_map(|a| match a.who {
            Attendee::Charge(id) => Some(id),
            Attendee::Named(_) => None,
        });
        if let Some(id) = charges.find(|id| !setup.charges().iter().any(|c| c.id == *id)) {
            return Err(ActaError::UnknownCharge(id));
        }
        if let (Some(started_at), Some(ended_at)) = (self.started_at, self.ended_at)
            && ended_at < started_at
        {
            return Err(ActaError::EndsBeforeStart { started_at, ended_at });
        }
        Ok(())
    }

    /// Present in the room or by video.
    pub fn present(&self) -> u32 {
        self.attendance.iter().filter(|a| a.presence != Presence::Absent).count() as u32
    }

    pub fn quorum(&self, board_quorum: Option<u16>) -> Quorum {
        match board_quorum {
            None => Quorum::Unknown,
            Some(quorum) if self.present() >= u32::from(quorum) => Quorum::Met,
            Some(_) => Quorum::NotMet,
        }
    }

    /// What the clerk and the first elder should look at, given the
    /// meeting's `items` and the church's `board_quorum`.
    pub fn flags(&self, items: &[AgendaItem], board_quorum: Option<u16>) -> Vec<Flag> {
        let mut flags = Vec::new();
        for o in &self.outcomes {
            if let Some(item) = items.iter().find(|i| i.id == o.item)
                && !o.outcome.fits(item.request)
            {
                let now = o.outcome.implied_request();
                flags.push(Flag::RequestChanged { item: o.item, previous: item.request, now, by: self.number });
            }
            let unexplained = o.note.as_deref().is_none_or(|n| n.trim().is_empty());
            if matches!(o.outcome, Outcome::Returned | Outcome::Postponed) && unexplained {
                flags.push(Flag::NoReason { item: o.item });
            }
        }
        if let (Quorum::NotMet, Some(quorum)) = (self.quorum(board_quorum), board_quorum) {
            flags.push(Flag::NoQuorum { present: self.present(), quorum });
        }
        flags
    }
}

/// Every version of one meeting's acta, oldest first. A correction adds a
/// version and keeps the ones before it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ActaHistory {
    versions: Vec<Acta>,
}

impl ActaHistory {
    pub fn new(first: Acta) -> Self {
        Self { versions: vec![first] }
    }

    /// The versions as stored, oldest first. None when there are none.
    pub fn from_versions(versions: Vec<Acta>) -> Option<Self> {
        (!versions.is_empty()).then_some(Self { versions })
    }

    pub fn correct(&mut self, corrected: Acta) -> Result<(), ActaError> {
        let meeting = self.current().meeting;
        if corrected.meeting != meeting {
            return Err(ActaError::OtherMeeting { acta: corrected.meeting, meeting });
        }
        self.versions.push(corrected);
        Ok(())
    }

    pub fn current(&self) -> &Acta {
        self.versions.last().expect("a history has at least one version")
    }

    pub fn versions(&self) -> &[Acta] {
        &self.versions
    }
}

/// The current outcome of every point that goes back to `office`, with
/// the acta that records it.
pub fn outcomes_for_office<'a>(
    office: &'a OfficeId,
    actas: &'a [ActaHistory],
    meetings: &'a [Meeting],
) -> impl Iterator<Item = (&'a Acta, &'a AgendaItem, &'a ItemOutcome)> {
    actas.iter().map(ActaHistory::current).flat_map(move |acta| {
        let items = meetings.iter().find(|m| m.id == acta.meeting).map_or(&[][..], |m| &m.items[..]);
        acta.outcomes.iter().filter_map(move |o| {
            let item = items.iter().find(|i| i.id == o.item && i.office.as_ref() == Some(office))?;
            Some((acta, item, o))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agenda::{MeetingKind, MeetingState, SectionId};
    use crate::setup::Change;
    use crate::{Actor, Date, Holder, NewCharge, Term};

    const BOARD: VotingBody = VotingBody::Board;

    fn number(n: u32) -> ActaNumber {
        ActaNumber { body: BOARD, year: 2026, n }
    }

    fn point(id: i64, office: &str, request: Request) -> AgendaItem {
        AgendaItem {
            id: ItemId(id),
            section: SectionId("finanzas".into()),
            office: Some(OfficeId::from(office)),
            title: format!("Punto {id}"),
            presenter: None,
            request,
            explanation: String::new(),
            received_on: None,
            scans: vec![],
            activity: None,
            source: None,
        }
    }

    fn meeting(id: i64, items: Vec<AgendaItem>) -> Meeting {
        Meeting {
            id: MeetingId(id),
            date: Date::try_from("2026-12-13").unwrap(),
            kind: MeetingKind::Regular,
            state: MeetingState::Held,
            time: None,
            place: None,
            number: Some(number(22)),
            sections: vec![],
            items,
        }
    }

    fn outcome(item: i64, outcome: Outcome, note: Option<&str>) -> ItemOutcome {
        ItemOutcome { item: ItemId(item), outcome, votes: None, note: note.map(Into::into) }
    }

    fn acta(meeting: i64, outcomes: Vec<ItemOutcome>) -> Acta {
        Acta {
            meeting: MeetingId(meeting),
            number: number(22),
            presided: Presider::Pastor,
            started_at: ServiceTime::try_from("19:00").ok(),
            ended_at: None,
            devotional_by: None,
            closing_prayer_by: None,
            previous: Some(PreviousActa::NotRead),
            attendance: vec![],
            outcomes,
            free: vec![],
            source: Source::Paper { typist: Actor::Developer, scans: vec![] },
        }
    }

    fn attending(presences: &[Presence]) -> Vec<Attendance> {
        presences.iter().enumerate().map(|(n, &presence)| Attendance { who: Attendee::Named(format!("Hermano {n}")), presence }).collect()
    }

    #[test]
    fn acta_numbers_count_per_body_per_year_and_restart_in_january() {
        let church = ActaNumber { body: VotingBody::Church, year: 2026, n: 40 };
        let existing = [number(20), number(21), church, ActaNumber { body: BOARD, year: 2025, n: 30 }];
        assert_eq!(ActaNumber::next(BOARD, 2026, &existing), number(22));
        assert_eq!(ActaNumber::next(VotingBody::Church, 2026, &existing).n, 41);
        assert_eq!(ActaNumber::next(BOARD, 2027, &existing), ActaNumber { body: BOARD, year: 2027, n: 1 });
        assert_eq!(number(22).to_string(), "22/2026");
    }

    #[test]
    fn an_inform_point_the_board_did_not_reach_is_postponed_without_a_flag() {
        assert!(Outcome::Postponed.fits(Request::Inform));
        assert!(!Outcome::Approved.fits(Request::Inform));
    }

    #[test]
    fn an_outcome_that_fits_raises_no_flag() {
        let items = [point(1, "tesorero", Request::AcceptReport), point(2, "musica", Request::ApproveExpense { amount: None })];
        let amount = Balboas::try_from("350").unwrap();
        let held = acta(1, vec![outcome(1, Outcome::Accepted, None), outcome(2, Outcome::ApprovedFor(amount), None)]);
        assert_eq!(held.flags(&items, None), []);
    }

    #[test]
    fn an_approval_of_an_inform_point_is_kept_and_reads_as_another_decision() {
        let items = [point(1, "diaconado", Request::Inform)];
        let held = acta(1, vec![outcome(1, Outcome::Approved, None)]);
        assert_eq!(held.outcomes[0].outcome, Outcome::Approved);
        let changed = Flag::RequestChanged { item: ItemId(1), previous: Request::Inform, now: Request::OtherDecision, by: number(22) };
        assert_eq!(held.flags(&items, None), [changed]);
    }

    #[test]
    fn a_point_returned_or_postponed_without_a_reason_is_flagged() {
        let items = [point(1, "tesorero", Request::AcceptReport), point(2, "tesorero", Request::ApprovePlan), point(3, "tesorero", Request::ApprovePlan)];
        let held = acta(
            1,
            vec![outcome(1, Outcome::Returned, None), outcome(2, Outcome::Postponed, Some("  ")), outcome(3, Outcome::Returned, Some("Falta la cotización"))],
        );
        assert_eq!(held.flags(&items, None), [Flag::NoReason { item: ItemId(1) }, Flag::NoReason { item: ItemId(2) }]);
    }

    #[test]
    fn video_counts_as_present_for_quorum_and_an_acta_without_quorum_is_kept_and_flagged() {
        let mut held = acta(1, vec![]);
        held.attendance = attending(&[Presence::Present, Presence::Video, Presence::Absent]);
        assert_eq!(held.present(), 2);
        assert_eq!(held.quorum(Some(2)), Quorum::Met);
        assert_eq!(held.quorum(Some(3)), Quorum::NotMet);
        assert_eq!(held.flags(&[], Some(3)), [Flag::NoQuorum { present: 2, quorum: 3 }]);
    }

    #[test]
    fn with_no_quorum_set_the_quorum_is_unknown_not_failed() {
        let held = acta(1, vec![]);
        assert_eq!(held.quorum(None), Quorum::Unknown);
        assert_eq!(held.flags(&[], None), []);
    }

    #[test]
    fn a_correction_keeps_the_earlier_version() {
        let first = acta(1, vec![outcome(1, Outcome::Approved, None)]);
        let mut history = ActaHistory::new(first.clone());
        let corrected = acta(1, vec![outcome(1, Outcome::Postponed, Some("Falta la cotización"))]);
        history.correct(corrected.clone()).unwrap();
        assert_eq!(history.versions(), [first, corrected.clone()]);
        assert_eq!(history.current(), &corrected);
        assert_eq!(history.correct(acta(2, vec![])), Err(ActaError::OtherMeeting { acta: MeetingId(2), meeting: MeetingId(1) }));
        assert_eq!(ActaHistory::from_versions(vec![]), None);
    }

    #[test]
    fn outcomes_for_office_returns_only_that_offices_points() {
        let meetings = [
            meeting(1, vec![point(1, "tesorero", Request::AcceptReport), point(2, "musica", Request::ApprovePlan)]),
            meeting(2, vec![point(3, "tesorero", Request::AcceptReport)]),
        ];
        let actas = [
            ActaHistory::new(acta(1, vec![outcome(1, Outcome::Accepted, None), outcome(2, Outcome::Approved, None)])),
            ActaHistory::new(acta(2, vec![outcome(3, Outcome::Returned, Some("Incompleto"))])),
        ];
        let treasurer = OfficeId::from("tesorero");
        let found: Vec<(i64, Outcome)> = outcomes_for_office(&treasurer, &actas, &meetings).map(|(_, i, o)| (i.id.0, o.outcome)).collect();
        assert_eq!(found, [(1, Outcome::Accepted), (3, Outcome::Returned)]);
    }

    #[test]
    fn an_acta_refuses_only_what_cannot_be() {
        let elder = NewCharge {
            office: OfficeId::from("primer-anciano"),
            holder: Holder { name: "Rubén Castillo".into(), email: None },
            term: Term::one_year(2026),
        };
        let setup = Setup::initial(&Change { church: Some("Iglesia".into()), elect: vec![elder], ..Change::default() }).unwrap();
        let m = meeting(1, vec![point(1, "tesorero", Request::Inform)]);
        let mut held = acta(1, vec![outcome(1, Outcome::Approved, None)]);
        held.attendance = vec![
            Attendance { who: Attendee::Charge(ChargeId(1)), presence: Presence::Present },
            Attendance { who: Attendee::Named("Pr. Gómez".into()), presence: Presence::Video },
        ];
        assert_eq!(held.check(&m, &setup), Ok(()), "a misfit outcome is not refused");
        let unknown_point = acta(1, vec![outcome(9, Outcome::Approved, None)]);
        assert_eq!(unknown_point.check(&m, &setup), Err(ActaError::UnknownItem(ItemId(9))));
        let mut unknown_charge = acta(1, vec![]);
        unknown_charge.attendance = vec![Attendance { who: Attendee::Charge(ChargeId(7)), presence: Presence::Present }];
        assert_eq!(unknown_charge.check(&m, &setup), Err(ActaError::UnknownCharge(ChargeId(7))));
        let mut backwards = acta(1, vec![]);
        backwards.ended_at = ServiceTime::try_from("18:00").ok();
        assert!(matches!(backwards.check(&m, &setup), Err(ActaError::EndsBeforeStart { .. })));
    }
}
