//! An office's activities and its annual plan. Each office writes its plan
//! of activities, one row each; the board approves the plan as one point,
//! and the approved activities that invite the church are the church's
//! calendar. A point slip's activity is the same record.
//!
//! Like the roster, nothing here is stored but its history: one `Recorded`
//! event per change, and `Activities` replays it. The process records
//! deviations and never blocks: a change to an approved activity's dates or
//! budget is kept and noticed as going back to the board, never refused.
//! Only an event that names an activity, plan, office or place that does
//! not exist is refused.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::access::May;
use crate::acta::{Acta, ActaNumber, Outcome};
use crate::agenda::{AgendaItem, PlaceRef};
use crate::catalog::OfficeId;
use crate::roster::holds;
use crate::schedule::{PlaceId, ServiceTime};
use crate::setup::Setup;
use crate::{Actor, Balboas, ChargeId, Date, church_year};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActivityId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanId(pub u32);

/// An activity an office holds: a row of its plan, or the back of a point slip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Activity {
    pub id: ActivityId,
    /// The office that holds it.
    pub office: OfficeId,
    pub name: String,
    pub dates: ActivityDates,
    pub time: Option<ServiceTime>,
    pub place: Option<PlaceRef>,
    pub purpose: Option<String>,
    pub audience: Option<String>,
    /// Who leads it.
    pub responsible: Option<String>,
    /// The people it needs. The slip's one box "Responsables y personas que hacen falta" fills this.
    pub people_needed: Option<String>,
    /// Another department it needs, as written.
    pub other_office: Option<String>,
    pub origin: Origin,
    /// The expected expense.
    pub budget: Option<Balboas>,
    pub income: Option<Balboas>,
    /// "Invita a la iglesia": the members are expected, so once approved it
    /// is on the church calendar. False for an activity only for the
    /// office's own team.
    pub invites_church: bool,
    /// The row came prefilled from the campo's or the division's calendar.
    pub from_calendar: Option<Origin>,
}

/// An activity as the office writes it. Only the office, a name and the
/// dates are needed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewActivity {
    pub office: OfficeId,
    pub name: String,
    pub dates: ActivityDates,
    pub time: Option<ServiceTime>,
    pub place: Option<PlaceRef>,
    pub purpose: Option<String>,
    pub audience: Option<String>,
    pub responsible: Option<String>,
    pub people_needed: Option<String>,
    pub other_office: Option<String>,
    #[serde(default)]
    pub origin: Origin,
    pub budget: Option<Balboas>,
    pub income: Option<Balboas>,
    #[serde(default)]
    pub invites_church: bool,
    pub from_calendar: Option<Origin>,
}

impl NewActivity {
    fn recorded(&self, id: ActivityId) -> Activity {
        let Self {
            office,
            name,
            dates,
            time,
            place,
            purpose,
            audience,
            responsible,
            people_needed,
            other_office,
            origin,
            budget,
            income,
            invites_church,
            from_calendar,
        } = self.clone();
        Activity {
            id,
            office,
            name: name.trim().to_owned(),
            dates,
            time,
            place,
            purpose: text(purpose),
            audience: text(audience),
            responsible: text(responsible),
            people_needed: text(people_needed),
            other_office: text(other_office),
            origin,
            budget,
            income,
            invites_church,
            from_calendar,
        }
    }
}

fn text(written: Option<String>) -> Option<String> {
    written.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())
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

    /// Every day the activity runs on.
    pub fn days(&self) -> Vec<Date> {
        match self {
            Self::Day(day) => vec![*day],
            Self::Range { from, to } => std::iter::successors(Some(*from), |d| Some(d.plus_days(1))).take_while(|d| d <= to).collect(),
            Self::List(dates) => dates.clone(),
        }
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

/// Where an activity comes from ("De dónde viene").
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Origin {
    #[default]
    Local,
    /// The local field (the campo); the slip names no field.
    Campo,
    UnionOrDivision,
}

/// An office's plan of activities for a period, one row per activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OfficePlan {
    pub id: PlanId,
    pub office: OfficeId,
    pub period: PlanPeriod,
    /// The columns shown, in order. A column turned off only hides what
    /// its rows hold.
    pub columns: Vec<PlanColumn>,
    pub rows: Vec<ActivityId>,
}

/// What a plan covers: a church year by default, or any run of days.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PlanPeriod {
    /// A church year, named for the calendar year it begins in.
    Year(u16),
    /// Never ends before it starts: refused when read.
    Range { from: Date, to: Date },
}

impl<'de> Deserialize<'de> for PlanPeriod {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "snake_case")]
        enum Written {
            Year(u16),
            Range { from: Date, to: Date },
        }
        match Written::deserialize(deserializer)? {
            Written::Year(year) => Ok(Self::Year(year)),
            Written::Range { from, to } if to < from => {
                Err(serde::de::Error::custom(format!("the plan ends on {to}, before it starts on {from}")))
            }
            Written::Range { from, to } => Ok(Self::Range { from, to }),
        }
    }
}

/// A column a plan may show beside each activity's name and dates, which
/// every plan shows. Simplifying a plan is turning columns off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PlanColumn {
    Purpose,
    Place,
    Audience,
    InvitesChurch,
    Budget,
    Origin,
    Responsible,
    OtherOffice,
    IncomeExpense,
}

impl PlanColumn {
    /// The columns a new plan shows. The rest are there to turn on.
    pub const DEFAULT: [Self; 6] = [Self::Purpose, Self::Place, Self::Audience, Self::InvitesChurch, Self::Budget, Self::Origin];
}

/// The point the board approved: a whole plan, or one activity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ApprovalOf {
    Plan(PlanId),
    Activity(ActivityId),
}

/// A change to the activities and plans. Edits carry the whole new value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ActivityEvent {
    /// Gets the next activity id.
    AddActivity(NewActivity),
    EditActivity { activity: ActivityId, value: NewActivity },
    /// Gets the next plan id.
    AddPlan { office: OfficeId, period: PlanPeriod, columns: Vec<PlanColumn> },
    EditPlan { plan: PlanId, period: PlanPeriod, columns: Vec<PlanColumn> },
    AddRow { plan: PlanId, activity: ActivityId },
    /// The activity stays, out of the plan.
    RemoveRow { plan: PlanId, activity: ActivityId },
    /// An acta approved the point: every activity it names except
    /// `returned`, which the board sent back to be corrected and brought
    /// again as points of their own.
    RecordApproval { of: ApprovalOf, acta: ActaNumber, returned: Vec<ActivityId> },
}

/// One step of the activities' history, as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, rename = "ActivityRecorded")]
pub struct Recorded {
    /// UTC, `YYYY-MM-DDTHH:MM:SSZ`, set by the database when the row is written.
    pub at: String,
    pub by: Actor,
    pub event: ActivityEvent,
}

/// What the board approved of an activity, kept as it was then.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Approved {
    pub acta: ActaNumber,
    pub dates: ActivityDates,
    pub budget: Option<Balboas>,
}

/// "Vuelve a la junta": an approved activity whose dates or budget changed
/// since. The first elder decides whether to put it on the agenda as an
/// informative point; nothing waits on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct BackToBoard {
    pub activity: ActivityId,
    pub approved_by: ActaNumber,
    pub dates: Option<Changed<ActivityDates>>,
    pub budget: Option<Changed<Option<Balboas>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Changed<T> {
    pub before: T,
    pub now: T,
}

impl<T: PartialEq> Changed<T> {
    fn of(before: T, now: T) -> Option<Self> {
        (before != now).then_some(Self { before, now })
    }
}

/// The activities and plans a history adds up to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Activities {
    activities: Vec<Activity>,
    plans: Vec<OfficePlan>,
    approvals: BTreeMap<ActivityId, Approved>,
}

impl Activities {
    /// What a stored history adds up to. It checks only what the history
    /// itself names, never the setup, so an office or place dropped since
    /// leaves recorded history readable.
    pub fn replay(events: &[Recorded]) -> Result<Self, ActivityError> {
        let mut activities = Self::default();
        for recorded in events {
            activities.then(&recorded.event)?;
        }
        Ok(activities)
    }

    /// Records one event, after checking that the offices, places and
    /// charge it names exist in `setup`. Leaves everything unchanged on an error.
    pub fn apply(&mut self, setup: &Setup, recorded: &Recorded) -> Result<(), ActivityError> {
        check(setup, recorded)?;
        self.then(&recorded.event)
    }

    fn then(&mut self, event: &ActivityEvent) -> Result<(), ActivityError> {
        match event {
            ActivityEvent::AddActivity(new) => {
                let id = ActivityId(self.activities.len() as u32 + 1);
                self.activities.push(new.recorded(id));
            }
            ActivityEvent::EditActivity { activity, value } => {
                let found = self.activities.iter_mut().find(|a| a.id == *activity).ok_or(ActivityError::UnknownActivity(*activity))?;
                *found = value.recorded(*activity);
            }
            ActivityEvent::AddPlan { office, period, columns } => {
                let id = PlanId(self.plans.len() as u32 + 1);
                self.plans.push(OfficePlan { id, office: office.clone(), period: *period, columns: once(columns), rows: Vec::new() });
            }
            ActivityEvent::EditPlan { plan, period, columns } => {
                let found = self.plan_mut(*plan)?;
                found.period = *period;
                found.columns = once(columns);
            }
            ActivityEvent::AddRow { plan, activity } => {
                self.known(*activity)?;
                let rows = &mut self.plan_mut(*plan)?.rows;
                if !rows.contains(activity) {
                    rows.push(*activity);
                }
            }
            ActivityEvent::RemoveRow { plan, activity } => {
                self.known(*activity)?;
                self.plan_mut(*plan)?.rows.retain(|row| row != activity);
            }
            ActivityEvent::RecordApproval { of, acta, returned } => {
                returned.iter().try_for_each(|id| self.known(*id).map(drop))?;
                let named = match of {
                    ApprovalOf::Plan(plan) => self.plan(*plan).ok_or(ActivityError::UnknownPlan(*plan))?.rows.clone(),
                    ApprovalOf::Activity(activity) => vec![self.known(*activity)?.id],
                };
                for id in named {
                    if returned.contains(&id) {
                        self.approvals.remove(&id);
                    } else {
                        let Activity { dates, budget, .. } = self.known(id)?.clone();
                        self.approvals.insert(id, Approved { acta: *acta, dates, budget });
                    }
                }
            }
        }
        Ok(())
    }

    fn known(&self, id: ActivityId) -> Result<&Activity, ActivityError> {
        self.activity(id).ok_or(ActivityError::UnknownActivity(id))
    }

    fn plan_mut(&mut self, id: PlanId) -> Result<&mut OfficePlan, ActivityError> {
        self.plans.iter_mut().find(|p| p.id == id).ok_or(ActivityError::UnknownPlan(id))
    }

    pub fn activities(&self) -> &[Activity] {
        &self.activities
    }

    pub fn activity(&self, id: ActivityId) -> Option<&Activity> {
        self.activities.iter().find(|a| a.id == id)
    }

    pub fn plans(&self) -> &[OfficePlan] {
        &self.plans
    }

    pub fn plan(&self, id: PlanId) -> Option<&OfficePlan> {
        self.plans.iter().find(|p| p.id == id)
    }

    /// What the board last approved of the activity. None when it has not
    /// approved it, or last returned it.
    pub fn approval(&self, id: ActivityId) -> Option<&Approved> {
        self.approvals.get(&id)
    }

    /// The church calendar from `from` through `to`: each day of each
    /// approved activity that invites the church, by date.
    pub fn calendar(&self, from: Date, to: Date) -> Vec<(Date, &Activity)> {
        let mut days: Vec<(Date, &Activity)> = self
            .activities
            .iter()
            .filter(|a| a.invites_church && self.approvals.contains_key(&a.id))
            .flat_map(|a| a.dates.days().into_iter().map(move |day| (day, a)))
            .filter(|(day, _)| (from..=to).contains(day))
            .collect();
        days.sort_by_key(|(day, a)| (*day, a.id));
        days
    }

    /// Every approved activity whose dates or budget differ from what the
    /// board approved: the notice "vuelve a la junta".
    pub fn back_to_board(&self) -> Vec<BackToBoard> {
        self.approvals
            .iter()
            .filter_map(|(id, approval)| {
                let now = self.activity(*id)?;
                let dates = Changed::of(approval.dates.clone(), now.dates.clone());
                let budget = Changed::of(approval.budget, now.budget);
                (dates.is_some() || budget.is_some()).then_some(BackToBoard { activity: *id, approved_by: approval.acta, dates, budget })
            })
            .collect()
    }

    /// Whether `actor` may record `event` on `today`. The developer may
    /// record anything. A charge serving today in the office that holds an
    /// activity or a plan, or in a variant of it, may add and edit it.
    /// Whoever records actas records the board's approvals. A charge that
    /// does not serve today may record nothing. This function is the whole rule.
    pub fn may_record(&self, setup: &Setup, today: Date, actor: &Actor, event: &ActivityEvent) -> bool {
        let id = match actor {
            Actor::Developer => return true,
            Actor::Charge(id) => *id,
        };
        let year = church_year(today, setup.year_starts());
        let Some(charge) = setup.charges().iter().find(|c| c.id == id && c.serves_in(year, setup.charges())) else {
            return false;
        };
        let in_office = |office: &OfficeId| holds(setup, charge, office);
        let holds_activity = |activity: &ActivityId| self.activity(*activity).is_some_and(|a| in_office(&a.office));
        let holds_plan = |plan: &PlanId| self.plan(*plan).is_some_and(|p| in_office(&p.office));
        match event {
            ActivityEvent::AddActivity(new) => in_office(&new.office),
            ActivityEvent::EditActivity { activity, value } => holds_activity(activity) && in_office(&value.office),
            ActivityEvent::AddPlan { office, period: _, columns: _ } => in_office(office),
            ActivityEvent::EditPlan { plan, period: _, columns: _ }
            | ActivityEvent::AddRow { plan, activity: _ }
            | ActivityEvent::RemoveRow { plan, activity: _ } => holds_plan(plan),
            ActivityEvent::RecordApproval { of: _, acta: _, returned: _ } => May::of(charge, setup.catalog()).record_actas,
        }
    }
}

/// The approvals `acta` records: one for each point it approves that names
/// a plan or an activity, with the rows that point returned.
pub fn approvals(acta: &Acta, items: &[AgendaItem]) -> Vec<ActivityEvent> {
    acta.outcomes
        .iter()
        .filter(|o| o.outcome == Outcome::Approved)
        .filter_map(|o| Some((o, items.iter().find(|i| i.id == o.item)?)))
        .flat_map(|(o, item)| {
            let named = item.plan.map(ApprovalOf::Plan).into_iter().chain(item.activity.map(ApprovalOf::Activity));
            named.map(|of| ActivityEvent::RecordApproval { of, acta: acta.number, returned: o.returned.clone() })
        })
        .collect()
}

fn once(columns: &[PlanColumn]) -> Vec<PlanColumn> {
    columns.iter().enumerate().filter(|(i, c)| !columns[..*i].contains(c)).map(|(_, c)| *c).collect()
}

/// What `apply` checks against the setup, and only there, never on replay.
/// Destructured in full, so a new field that names something is checked.
fn check(setup: &Setup, recorded: &Recorded) -> Result<(), ActivityError> {
    let Recorded { at: _, by, event } = recorded;
    if let Actor::Charge(id) = by
        && !setup.charges().iter().any(|c| c.id == *id)
    {
        return Err(ActivityError::UnknownCharge(*id));
    }
    let office = |id: &OfficeId| match setup.catalog().office(id) {
        Some(_) => Ok(()),
        None => Err(ActivityError::UnknownOffice(id.clone())),
    };
    let activity = |new: &NewActivity| {
        let NewActivity {
            office: o,
            name: _,
            dates: _,
            time: _,
            place,
            purpose: _,
            audience: _,
            responsible: _,
            people_needed: _,
            other_office: _,
            origin: _,
            budget: _,
            income: _,
            invites_church: _,
            from_calendar: _,
        } = new;
        office(o)?;
        match place {
            Some(PlaceRef::Church(id)) if !setup.places().iter().any(|p| p.id == *id) => Err(ActivityError::UnknownPlace(id.clone())),
            _ => Ok(()),
        }
    };
    match event {
        ActivityEvent::AddActivity(new) | ActivityEvent::EditActivity { activity: _, value: new } => activity(new),
        ActivityEvent::AddPlan { office: o, period: _, columns: _ } => office(o),
        ActivityEvent::EditPlan { plan: _, period: _, columns: _ }
        | ActivityEvent::AddRow { plan: _, activity: _ }
        | ActivityEvent::RemoveRow { plan: _, activity: _ }
        | ActivityEvent::RecordApproval { of: _, acta: _, returned: _ } => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivityError {
    UnknownActivity(ActivityId),
    UnknownPlan(PlanId),
    UnknownOffice(OfficeId),
    UnknownPlace(PlaceId),
    UnknownCharge(ChargeId),
}

impl fmt::Display for ActivityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownActivity(id) => write!(f, "there is no activity {}", id.0),
            Self::UnknownPlan(id) => write!(f, "there is no plan {}", id.0),
            Self::UnknownOffice(id) => write!(f, "the catalog has no office {}", id.0),
            Self::UnknownPlace(id) => write!(f, "the church has no place {}", id.0),
            Self::UnknownCharge(id) => write!(f, "charge {} is not held", id.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acta::{ItemOutcome, Presider};
    use crate::agenda::{ItemId, MeetingId, Request, SectionId};
    use crate::setup::{Change, VotingBody};
    use crate::{Holder, Month, NewCharge, Source, Term};

    const MARTA: ChargeId = ChargeId(1);
    const DANIEL: ChargeId = ChargeId(2);
    const ANA: ChargeId = ChargeId(3);
    const YOUTH: &str = "ministerio-joven";
    const TODAY: Date = Date { year: 2026, month: Month::JANUARY, day: 15 };
    const ACTA: ActaNumber = ActaNumber { body: VotingBody::Board, year: 2027, n: 2 };

    fn day(text: &str) -> Date {
        Date::try_from(text).unwrap()
    }

    /// The youth director, the music coordinator and the clerk, with the temple.
    fn setup() -> Setup {
        let held = |office: &str, name: &str| NewCharge {
            office: OfficeId::from(office),
            holder: Holder { name: name.into(), email: None },
            term: Term::one_year(2026),
        };
        let places = serde_json::from_str(r#"[{"id":"templo","name":"Templo","kind":"own"}]"#).unwrap();
        Setup::initial(&Change {
            church: Some("Iglesia".into()),
            places: Some(places),
            elect: vec![held(YOUTH, "Marta"), held("musica", "Daniel"), held("secretario", "Ana")],
            ..Change::default()
        })
        .unwrap()
    }

    fn new(name: &str, dates: ActivityDates) -> NewActivity {
        NewActivity {
            office: OfficeId::from(YOUTH),
            name: name.into(),
            dates,
            time: None,
            place: None,
            purpose: None,
            audience: None,
            responsible: None,
            people_needed: None,
            other_office: None,
            origin: Origin::Local,
            budget: None,
            income: None,
            invites_church: false,
            from_calendar: None,
        }
    }

    fn balboas(text: &str) -> Option<Balboas> {
        Balboas::try_from(text).ok()
    }

    struct Church {
        setup: Setup,
        activities: Activities,
        events: Vec<Recorded>,
    }

    impl Church {
        fn new() -> Self {
            Self { setup: setup(), activities: Activities::default(), events: Vec::new() }
        }

        fn record(&mut self, by: Actor, event: ActivityEvent) -> Result<(), ActivityError> {
            let recorded = Recorded { at: "2026-11-27T05:32:43Z".into(), by, event };
            self.activities.apply(&self.setup, &recorded)?;
            self.events.push(recorded);
            Ok(())
        }

        fn by(&mut self, charge: ChargeId, event: ActivityEvent) {
            self.record(Actor::Charge(charge), event).unwrap();
        }

        /// The youth plan for 2027 with these activities as its rows, in order.
        fn youth_plan(&mut self, rows: Vec<NewActivity>) -> PlanId {
            self.by(MARTA, ActivityEvent::AddPlan { office: YOUTH.into(), period: PlanPeriod::Year(2027), columns: PlanColumn::DEFAULT.to_vec() });
            let plan = PlanId(self.activities.plans().len() as u32);
            for row in rows {
                self.by(MARTA, ActivityEvent::AddActivity(row));
                let activity = ActivityId(self.activities.activities().len() as u32);
                self.by(MARTA, ActivityEvent::AddRow { plan, activity });
            }
            plan
        }

        /// The board approves `plan` in acta 2/2027, returning `returned`.
        fn approve(&mut self, plan: PlanId, returned: Vec<ActivityId>) {
            let point = AgendaItem {
                id: ItemId(7),
                section: SectionId("planes-de-departamentos".into()),
                office: Some(YOUTH.into()),
                title: "Plan anual 2027".into(),
                presenter: None,
                request: Request::ApprovePlan,
                explanation: String::new(),
                received_on: None,
                scans: vec![],
                activity: None,
                plan: Some(plan),
                source: None,
            };
            let acta = Acta {
                meeting: MeetingId(1),
                number: ACTA,
                presided: Presider::Pastor,
                started_at: None,
                ended_at: None,
                devotional_by: None,
                closing_prayer_by: None,
                previous: None,
                attendance: vec![],
                outcomes: vec![ItemOutcome { item: point.id, outcome: Outcome::Approved, votes: None, note: None, returned }],
                free: vec![],
                source: Source::Paper { typist: Actor::Developer, scans: vec![] },
            };
            for event in approvals(&acta, &[point]) {
                self.by(ANA, event);
            }
        }

        fn activity(&self, id: u32) -> &Activity {
            self.activities.activity(ActivityId(id)).unwrap()
        }

        /// The office rewrites activity `id` with `change`.
        fn edit(&mut self, id: u32, change: impl FnOnce(&mut NewActivity)) {
            let Activity {
                id: _,
                office,
                name,
                dates,
                time,
                place,
                purpose,
                audience,
                responsible,
                people_needed,
                other_office,
                origin,
                budget,
                income,
                invites_church,
                from_calendar,
            } = self.activity(id).clone();
            let mut value = NewActivity {
                office,
                name,
                dates,
                time,
                place,
                purpose,
                audience,
                responsible,
                people_needed,
                other_office,
                origin,
                budget,
                income,
                invites_church,
                from_calendar,
            };
            change(&mut value);
            self.by(MARTA, ActivityEvent::EditActivity { activity: ActivityId(id), value });
        }
    }

    fn camp() -> NewActivity {
        NewActivity {
            invites_church: true,
            budget: balboas("480"),
            place: Some(PlaceRef::Church("templo".into())),
            ..new("Campamento de jóvenes", ActivityDates::range(day("2027-04-14"), day("2027-04-16")).unwrap())
        }
    }

    #[test]
    fn an_activity_needs_only_a_name_and_dates() {
        let written = r#"{"office":"ministerio-joven","name":" Vigilia ","dates":{"day":"2027-03-20"}}"#;
        let mut church = Church::new();
        church.by(MARTA, ActivityEvent::AddActivity(serde_json::from_str(written).unwrap()));
        let vigil = church.activity(1);
        assert_eq!((vigil.name.as_str(), &vigil.dates), ("Vigilia", &ActivityDates::Day(day("2027-03-20"))));
        assert_eq!((vigil.origin, vigil.invites_church, vigil.budget, vigil.from_calendar), (Origin::Local, false, None, None));
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
        let plan = serde_json::from_str::<PlanPeriod>(r#"{"range":{"from":"2027-06-01","to":"2027-01-01"}}"#).unwrap_err();
        assert!(plan.to_string().contains("before it starts"), "{plan}");
    }

    #[test]
    fn turning_a_column_off_keeps_the_data_and_turning_it_on_shows_it_again() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![NewActivity { purpose: Some("Consagración".into()), ..camp() }]);
        let without_purpose: Vec<PlanColumn> = PlanColumn::DEFAULT.into_iter().filter(|c| *c != PlanColumn::Purpose).collect();
        church.by(MARTA, ActivityEvent::EditPlan { plan, period: PlanPeriod::Year(2027), columns: without_purpose });
        assert!(!church.activities.plan(plan).unwrap().columns.contains(&PlanColumn::Purpose));
        assert_eq!(church.activity(1).purpose.as_deref(), Some("Consagración"), "hidden, not deleted");
        church.by(MARTA, ActivityEvent::EditPlan { plan, period: PlanPeriod::Year(2027), columns: PlanColumn::DEFAULT.to_vec() });
        assert!(church.activities.plan(plan).unwrap().columns.contains(&PlanColumn::Purpose));
        assert_eq!(church.activity(1).purpose.as_deref(), Some("Consagración"));
    }

    #[test]
    fn a_plan_approved_with_one_returned_row_approves_the_rest_and_leaves_the_returned_one_unapproved() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp(), new("Semana de oración joven", ActivityDates::Day(day("2027-03-20")))]);
        church.approve(plan, vec![ActivityId(2)]);
        let approval = church.activities.approval(ActivityId(1)).unwrap();
        assert_eq!((approval.acta, &approval.dates, approval.budget), (ACTA, &camp().dates, balboas("480")), "the approval keeps what was approved");
        assert_eq!(church.activities.approval(ActivityId(2)), None);
        assert_eq!(church.activities.plan(plan).unwrap().rows, [ActivityId(1), ActivityId(2)], "the returned row stays in the plan");
    }

    #[test]
    fn only_approved_rows_that_invite_the_church_are_on_the_calendar_each_on_its_dates() {
        let mut church = Church::new();
        let fasts = ActivityDates::list(vec![day("2027-05-01"), day("2027-03-06")]).unwrap();
        let plan = church.youth_plan(vec![
            camp(),
            NewActivity { invites_church: true, ..new("Ayuno", fasts) },
            new("Reunión del equipo", ActivityDates::Day(day("2027-03-07"))),
            NewActivity { invites_church: true, ..new("Día del joven", ActivityDates::Day(day("2027-03-20"))) },
        ]);
        church.by(MARTA, ActivityEvent::AddActivity(NewActivity { invites_church: true, ..new("Sin aprobar", ActivityDates::Day(day("2027-03-21"))) }));
        church.approve(plan, vec![ActivityId(4)]);
        let calendar: Vec<(String, &str)> =
            church.activities.calendar(day("2027-03-01"), day("2027-04-15")).into_iter().map(|(d, a)| (d.to_string(), a.name.as_str())).collect();
        assert_eq!(
            calendar,
            [
                ("2027-03-06".into(), "Ayuno"),
                ("2027-04-14".into(), "Campamento de jóvenes"),
                ("2027-04-15".into(), "Campamento de jóvenes"),
            ]
        );
    }

    #[test]
    fn changing_an_approved_rows_date_or_budget_raises_the_back_to_board_notice_with_before_and_after() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp(), new("Vigilia", ActivityDates::Day(day("2027-03-20")))]);
        church.approve(plan, vec![]);
        church.edit(1, |a| a.place = Some(PlaceRef::Other("Playa de Coronado".into())));
        church.edit(2, |a| a.people_needed = Some("Dos diáconos".into()));
        assert_eq!(church.activities.back_to_board(), [], "a change of place or people is recorded, not noticed");
        assert_eq!(church.activity(1).place, Some(PlaceRef::Other("Playa de Coronado".into())));

        let moved = ActivityDates::Day(day("2027-03-27"));
        church.edit(1, |a| a.budget = balboas("600"));
        church.edit(2, |a| a.dates = moved.clone());
        let notices = church.activities.back_to_board();
        assert_eq!(
            notices,
            [
                BackToBoard { activity: ActivityId(1), approved_by: ACTA, dates: None, budget: Changed::of(balboas("480"), balboas("600")) },
                BackToBoard {
                    activity: ActivityId(2),
                    approved_by: ACTA,
                    dates: Changed::of(ActivityDates::Day(day("2027-03-20")), moved.clone()),
                    budget: None,
                },
            ]
        );
        assert_eq!(church.activity(2).dates, moved, "the change is kept, not refused");
        assert_eq!(church.activities.calendar(day("2027-03-27"), day("2027-03-27")).len(), 0, "the vigil does not invite the church");
    }

    #[test]
    fn a_row_prefilled_from_the_campo_calendar_is_marked() {
        let mut church = Church::new();
        let given = NewActivity { origin: Origin::Campo, from_calendar: Some(Origin::Campo), ..camp() };
        church.youth_plan(vec![given, new("Vigilia", ActivityDates::Day(day("2027-03-20")))]);
        assert_eq!(church.activity(1).from_calendar, Some(Origin::Campo));
        assert_eq!(church.activity(2).from_calendar, None);
    }

    #[test]
    fn a_removed_row_keeps_its_activity() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp()]);
        church.by(MARTA, ActivityEvent::RemoveRow { plan, activity: ActivityId(1) });
        assert_eq!(church.activities.plan(plan).unwrap().rows, []);
        assert_eq!(church.activity(1).name, "Campamento de jóvenes");
    }

    #[test]
    fn an_offices_charge_may_edit_its_plan_and_another_offices_may_not() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp()]);
        let may = |church: &Church, actor: Actor, event: &ActivityEvent| church.activities.may_record(&church.setup, TODAY, &actor, event);
        let edit = ActivityEvent::EditPlan { plan, period: PlanPeriod::Year(2027), columns: vec![] };
        let add_row = ActivityEvent::AddRow { plan, activity: ActivityId(1) };
        let approve = ActivityEvent::RecordApproval { of: ApprovalOf::Plan(plan), acta: ACTA, returned: vec![] };
        let edit_camp = ActivityEvent::EditActivity { activity: ActivityId(1), value: camp() };
        let to_music = ActivityEvent::EditActivity { activity: ActivityId(1), value: NewActivity { office: "musica".into(), ..camp() } };
        for (case, actor, event, allowed) in [
            ("the youth director edits her plan", Actor::Charge(MARTA), &edit, true),
            ("the youth director adds a row", Actor::Charge(MARTA), &add_row, true),
            ("the youth director edits her activity", Actor::Charge(MARTA), &edit_camp, true),
            ("the youth director hands her activity to music", Actor::Charge(MARTA), &to_music, false),
            ("the music coordinator edits the youth plan", Actor::Charge(DANIEL), &edit, false),
            ("the music coordinator edits a youth activity", Actor::Charge(DANIEL), &edit_camp, false),
            ("the youth director records the approval", Actor::Charge(MARTA), &approve, false),
            ("the clerk records the approval", Actor::Charge(ANA), &approve, true),
            ("the clerk edits the youth plan", Actor::Charge(ANA), &edit, false),
            ("the developer edits the youth plan", Actor::Developer, &edit, true),
        ] {
            assert_eq!(may(&church, actor, event), allowed, "{case}");
        }
    }

    #[test]
    fn only_unknown_ids_offices_or_places_are_refused() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp()]);
        let refused = |church: &mut Church, event| church.record(Actor::Developer, event).unwrap_err();
        assert_eq!(refused(&mut church, ActivityEvent::AddRow { plan, activity: ActivityId(9) }), ActivityError::UnknownActivity(ActivityId(9)));
        assert_eq!(refused(&mut church, ActivityEvent::AddRow { plan: PlanId(9), activity: ActivityId(1) }), ActivityError::UnknownPlan(PlanId(9)));
        let obispo = ActivityEvent::AddPlan { office: "obispo".into(), period: PlanPeriod::Year(2027), columns: vec![] };
        assert_eq!(refused(&mut church, obispo), ActivityError::UnknownOffice("obispo".into()));
        let gym = NewActivity { place: Some(PlaceRef::Church("gimnasio".into())), ..camp() };
        assert_eq!(refused(&mut church, ActivityEvent::AddActivity(gym)), ActivityError::UnknownPlace("gimnasio".into()));
        let returned = ActivityEvent::RecordApproval { of: ApprovalOf::Plan(plan), acta: ACTA, returned: vec![ActivityId(9)] };
        assert_eq!(refused(&mut church, returned), ActivityError::UnknownActivity(ActivityId(9)));
        assert_eq!(church.activities.approval(ActivityId(1)), None, "a refused approval approves nothing");
    }

    #[test]
    fn replay_gives_the_same_state() {
        let mut church = Church::new();
        let plan = church.youth_plan(vec![camp(), new("Vigilia", ActivityDates::Day(day("2027-03-20")))]);
        church.approve(plan, vec![ActivityId(2)]);
        church.edit(1, |a| a.budget = balboas("600"));
        church.by(MARTA, ActivityEvent::RemoveRow { plan, activity: ActivityId(2) });
        let stored = serde_json::to_string(&church.events).unwrap();
        let replayed = Activities::replay(&serde_json::from_str::<Vec<Recorded>>(&stored).unwrap()).unwrap();
        assert_eq!(replayed, church.activities);
    }
}
