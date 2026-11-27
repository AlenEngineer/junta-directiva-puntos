//! A department's recurring work. A program repeats on one or more of the
//! church's regular services and is split into turns (by month or by
//! service date) among the office's team. Whoever holds a turn leads every
//! service of the program in it and fills each service's roles.
//!
//! The roster is never stored. Its history is: one `Recorded` event per
//! change, and `Roster` replays it. The process is never blocked: a turn
//! left empty, a preacher filled before the pastor answers or an answer
//! recorded out of order is a state the queries report, not a refusal.
//! Only input that names something that does not exist, or a program that
//! lists one service twice, is refused.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::catalog::OfficeId;
use crate::schedule::{Service, ServiceId, Weekday};
use crate::setup::Setup;
use crate::{Actor, Charge, ChargeId, Date, Month, church_year, normalize_email};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HelperId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProgramId(pub u32);

/// Someone an office names itself, such as a Sabbath School teacher or a
/// club counselor. A helper starts as a name and holds turns. The office
/// may add an email later and invite them; an invited helper sees only
/// their own turns and roles ("Mi semana"), never the desk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Helper {
    pub id: HelperId,
    pub office: OfficeId,
    pub name: String,
    /// Where the office invites the helper.
    pub email: Option<String>,
    pub active: bool,
}

/// Recurring work of an office on one or more of the church's services,
/// such as the elders' Wednesday, Sabbath and Sunday. The roles belong to
/// the office, not to a charge, so a new head inherits them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Program {
    pub id: ProgramId,
    pub office: OfficeId,
    pub name: String,
    pub split: Split,
    /// Each service at most once.
    pub services: Vec<ProgramService>,
}

impl Program {
    /// The roles of `service`, if the program holds it.
    pub fn roles(&self, service: &ServiceId) -> Option<&[Role]> {
        self.services.iter().find(|s| s.service == *service).map(|s| s.roles.as_slice())
    }
}

/// A service of a program and the roles filled on each of its dates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProgramService {
    pub service: ServiceId,
    pub roles: Vec<Role>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Split {
    /// One turn per calendar month, as the elders split the preaching.
    ByMonth,
    /// One turn per date any of the program's services falls on.
    ByDate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Role {
    pub name: String,
    pub kind: RoleKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoleKind {
    Normal,
    /// Needs the pastor's approval, which the elder records.
    Preaching,
}

/// The roles offered when a program takes up `service`, for the office to
/// edit; nobody leads by role, the turn's holder does. The Sabbath list is
/// the order of worship in the Church Manual, p. 229.
pub fn suggested_roles(service: &Service) -> Vec<Role> {
    let roles: &[(&str, RoleKind)] = match service.weekday {
        Weekday::Saturday => &[
            ("Predicador", RoleKind::Preaching),
            ("Anuncios", RoleKind::Normal),
            ("Invocación", RoleKind::Normal),
            ("Lectura bíblica", RoleKind::Normal),
            ("Oración", RoleKind::Normal),
            ("Diezmos y ofrendas", RoleKind::Normal),
            ("Música especial", RoleKind::Normal),
        ],
        Weekday::Sunday => &[("Predicador", RoleKind::Preaching)],
        Weekday::Wednesday => &[("Meditación", RoleKind::Preaching)],
        Weekday::Monday | Weekday::Tuesday | Weekday::Thursday | Weekday::Friday => &[],
    };
    roles.iter().map(|&(name, kind)| Role { name: name.into(), kind }).collect()
}

/// Who holds a turn: a charge of the team, or a helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Member {
    Charge(ChargeId),
    Helper(HelperId),
}

/// Who fills a role. A guest preacher need not be on the team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Filler {
    Member(Member),
    Name(String),
}

/// What one turn covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Period {
    Month { year: u16, month: Month },
    Date(Date),
}

impl Period {
    /// The turn of a program split by `split` that `date` falls in.
    pub fn of(split: Split, date: Date) -> Self {
        match split {
            Split::ByMonth => Self::Month { year: date.year, month: date.month },
            Split::ByDate => Self::Date(date),
        }
    }
}

/// A preaching role's way to the pulpit: proposed by the elder, sent to the
/// pastor with the rest of the month, then his answer as the elder records it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum PastorApproval {
    Proposed,
    WithPastor,
    Approved,
    /// The slot is empty again, with the pastor's reason.
    NotApproved { note: String },
}

/// One role of one service on one date of a program, as the roster reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Slot {
    pub role: Role,
    /// Added for this service and date only, not in the service's roles.
    pub extra: bool,
    pub filler: Option<Filler>,
    /// Only ever on a preaching role.
    pub approval: Option<PastorApproval>,
}

/// A change to the roster. Edits carry the whole new value, so the event
/// before it in the history is the previous value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum RosterEvent {
    /// Gets the next helper id.
    AddHelper { office: OfficeId, name: String, email: Option<String> },
    EditHelper { helper: HelperId, name: String, email: Option<String>, active: bool },
    /// Gets the next program id.
    AddProgram { office: OfficeId, name: String, split: Split, services: Vec<ProgramService> },
    EditProgram { program: ProgramId, name: String, split: Split, services: Vec<ProgramService> },
    /// One turn covers every service of the program in `period`. `None`
    /// leaves the period without anyone.
    AssignTurn { program: ProgramId, period: Period, member: Option<Member> },
    /// `None` empties the role. Filling a preaching role proposes it again,
    /// whatever the pastor said about the one before.
    FillSlot { program: ProgramId, service: ServiceId, date: Date, role: String, filler: Option<Filler> },
    AddExtraRole { program: ProgramId, service: ServiceId, date: Date, role: Role },
    /// Every proposed preacher of the month, on every service, goes to the
    /// pastor at once.
    SendToPastor { program: ProgramId, year: u16, month: Month },
    /// A refusal empties the slot and keeps `note`.
    RecordPastorAnswer {
        program: ProgramId,
        service: ServiceId,
        date: Date,
        role: String,
        approved: bool,
        note: Option<String>,
    },
}

/// One step of the roster's history, as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Recorded {
    /// UTC, `YYYY-MM-DDTHH:MM:SSZ`, set by the database when the row is written.
    pub at: String,
    pub by: Actor,
    pub event: RosterEvent,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SlotState {
    filler: Option<Filler>,
    approval: Option<PastorApproval>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Touched {
    Turn(ProgramId, Period),
    Slot(ProgramId, ServiceId, Date, String),
}

/// The roster a history adds up to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roster {
    helpers: Vec<Helper>,
    programs: Vec<Program>,
    /// A period with no entry has nobody.
    turns: BTreeMap<(ProgramId, Period), Member>,
    slots: BTreeMap<(ProgramId, ServiceId, Date, String), SlotState>,
    extras: BTreeMap<(ProgramId, ServiceId, Date), Vec<Role>>,
    log: Vec<Recorded>,
    /// For each turn and slot, the positions in `log` that changed it.
    touched: BTreeMap<Touched, Vec<usize>>,
}

impl Roster {
    /// The roster a stored history adds up to. It checks only what the
    /// history itself names, never the setup: a charge released or a
    /// service dropped since must not make recorded history unreadable.
    pub fn replay(events: &[Recorded]) -> Result<Self, RosterError> {
        let mut roster = Self::default();
        for recorded in events {
            roster.then(recorded.clone())?;
        }
        Ok(roster)
    }

    /// Records one event, after checking that the offices, charges and
    /// services it names exist in `setup`. Leaves the roster unchanged on
    /// an error.
    pub fn apply(&mut self, setup: &Setup, recorded: Recorded) -> Result<(), RosterError> {
        check(setup, &recorded)?;
        self.then(recorded)
    }

    fn then(&mut self, recorded: Recorded) -> Result<(), RosterError> {
        let mut touched = Vec::new();
        match &recorded.event {
            RosterEvent::AddHelper { office, name, email } => {
                let id = HelperId(self.helpers.len() as u32 + 1);
                self.helpers.push(Helper {
                    id,
                    office: office.clone(),
                    name: name.trim().to_owned(),
                    email: clean_email(email),
                    active: true,
                });
            }
            RosterEvent::EditHelper { helper, name, email, active } => {
                let found = self.helpers.iter_mut().find(|h| h.id == *helper).ok_or(RosterError::UnknownHelper(*helper))?;
                found.name = name.trim().to_owned();
                found.email = clean_email(email);
                found.active = *active;
            }
            RosterEvent::AddProgram { office, name, split, services } => {
                listed_once(services)?;
                let id = ProgramId(self.programs.len() as u32 + 1);
                self.programs.push(Program {
                    id,
                    office: office.clone(),
                    name: name.trim().to_owned(),
                    split: *split,
                    services: services.clone(),
                });
            }
            RosterEvent::EditProgram { program, name, split, services } => {
                listed_once(services)?;
                let found =
                    self.programs.iter_mut().find(|p| p.id == *program).ok_or(RosterError::UnknownProgram(*program))?;
                found.name = name.trim().to_owned();
                found.split = *split;
                found.services = services.clone();
            }
            RosterEvent::AssignTurn { program, period, member } => {
                self.known(*program)?;
                if let Some(Member::Helper(helper)) = member {
                    self.known_helper(*helper)?;
                }
                match member {
                    Some(member) => self.turns.insert((*program, *period), *member),
                    None => self.turns.remove(&(*program, *period)),
                };
                touched.push(Touched::Turn(*program, *period));
            }
            RosterEvent::FillSlot { program, service, date, role, filler } => {
                let kind = self.role_kind(*program, service, *date, role)?;
                if let Some(Filler::Member(Member::Helper(helper))) = filler {
                    self.known_helper(*helper)?;
                }
                let slot = self.slots.entry((*program, service.clone(), *date, role.clone())).or_default();
                slot.filler = filler.clone();
                slot.approval = (kind == RoleKind::Preaching && filler.is_some()).then_some(PastorApproval::Proposed);
                touched.push(Touched::Slot(*program, service.clone(), *date, role.clone()));
            }
            RosterEvent::AddExtraRole { program, service, date, role } => {
                self.service_roles(*program, service)?;
                let extras = self.extras.entry((*program, service.clone(), *date)).or_default();
                if !extras.iter().any(|r| r.name == role.name) {
                    extras.push(role.clone());
                }
                touched.push(Touched::Slot(*program, service.clone(), *date, role.name.clone()));
            }
            RosterEvent::SendToPastor { program, year, month } => {
                self.known(*program)?;
                let (from, to) = (Date::first_of(*year, *month), Date::last_of(*year, *month));
                for ((p, service, date, role), slot) in &mut self.slots {
                    if p == program && (from..=to).contains(date) && slot.approval == Some(PastorApproval::Proposed) {
                        slot.approval = Some(PastorApproval::WithPastor);
                        touched.push(Touched::Slot(*p, service.clone(), *date, role.clone()));
                    }
                }
            }
            RosterEvent::RecordPastorAnswer { program, service, date, role, approved, note } => {
                if self.role_kind(*program, service, *date, role)? != RoleKind::Preaching {
                    return Err(RosterError::NotPreaching { program: *program, role: role.clone() });
                }
                let slot = self.slots.entry((*program, service.clone(), *date, role.clone())).or_default();
                if *approved {
                    slot.approval = Some(PastorApproval::Approved);
                } else {
                    slot.filler = None;
                    slot.approval = Some(PastorApproval::NotApproved { note: note.clone().unwrap_or_default() });
                }
                touched.push(Touched::Slot(*program, service.clone(), *date, role.clone()));
            }
        }
        let at = self.log.len();
        for key in touched {
            self.touched.entry(key).or_default().push(at);
        }
        self.log.push(recorded);
        Ok(())
    }

    fn known(&self, program: ProgramId) -> Result<&Program, RosterError> {
        self.program(program).ok_or(RosterError::UnknownProgram(program))
    }

    fn known_helper(&self, helper: HelperId) -> Result<&Helper, RosterError> {
        self.helper(helper).ok_or(RosterError::UnknownHelper(helper))
    }

    fn service_roles(&self, program: ProgramId, service: &ServiceId) -> Result<&[Role], RosterError> {
        self.known(program)?
            .roles(service)
            .ok_or_else(|| RosterError::ServiceNotInProgram { program, service: service.clone() })
    }

    /// A role of the service's template, or one added for `date` only.
    fn role_kind(&self, program: ProgramId, service: &ServiceId, date: Date, role: &str) -> Result<RoleKind, RosterError> {
        self.service_roles(program, service)?
            .iter()
            .chain(self.extras.get(&(program, service.clone(), date)).into_iter().flatten())
            .find(|r| r.name == role)
            .map(|r| r.kind)
            .ok_or_else(|| RosterError::UnknownRole { program, service: service.clone(), date, role: role.to_owned() })
    }
}

impl Roster {
    pub fn helpers(&self) -> &[Helper] {
        &self.helpers
    }

    pub fn helper(&self, id: HelperId) -> Option<&Helper> {
        self.helpers.iter().find(|h| h.id == id)
    }

    pub fn programs(&self) -> &[Program] {
        &self.programs
    }

    pub fn program(&self, id: ProgramId) -> Option<&Program> {
        self.programs.iter().find(|p| p.id == id)
    }

    pub fn turn(&self, program: ProgramId, period: &Period) -> Option<&Member> {
        self.turns.get(&(program, *period))
    }

    /// Who holds the turn `date` falls in.
    pub fn turn_on(&self, program: ProgramId, date: Date) -> Option<&Member> {
        let split = self.program(program)?.split;
        self.turn(program, &Period::of(split, date))
    }

    /// The roles of `service` on `date` in the program: the service's
    /// template, then the roles added for that service and date only.
    pub fn slots_on(&self, program: ProgramId, service: &ServiceId, date: Date) -> Vec<Slot> {
        let Some(roles) = self.program(program).and_then(|p| p.roles(service)) else {
            return Vec::new();
        };
        let template = roles.iter().map(|r| (r, false));
        let extras = self
            .extras
            .get(&(program, service.clone(), date))
            .into_iter()
            .flatten()
            .filter(|r| !roles.iter().any(|t| t.name == r.name))
            .map(|r| (r, true));
        template
            .chain(extras)
            .map(|(role, extra)| {
                let state = self.slots.get(&(program, service.clone(), date, role.name.clone()));
                Slot {
                    role: role.clone(),
                    extra,
                    filler: state.and_then(|s| s.filler.clone()),
                    approval: state.and_then(|s| s.approval.clone()).filter(|_| role.kind == RoleKind::Preaching),
                }
            })
            .collect()
    }

    /// The program's turns from `from` through `to`, one for each month or
    /// date any of its services falls in. A service the schedule no longer
    /// has adds none.
    pub fn periods(&self, setup: &Setup, program: ProgramId, from: Date, to: Date) -> Vec<Period> {
        let Some(found) = self.program(program) else {
            return Vec::new();
        };
        let mut periods: Vec<Period> =
            service_dates(setup, found, from, to).into_iter().map(|(_, date)| Period::of(found.split, date)).collect();
        periods.dedup();
        periods
    }

    /// Turns with a service in the next `window_days` and nobody holding
    /// them: the office's "Para hacer".
    pub fn unassigned(&self, setup: &Setup, program: ProgramId, today: Date, window_days: u16) -> Vec<Period> {
        self.periods(setup, program, today, today.plus_days(window_days.into()))
            .into_iter()
            .filter(|period| self.turn(program, period).is_none())
            .collect()
    }

    /// Roles nobody fills on the services of held turns in the next
    /// `window_days`: the turn holder's "Para hacer".
    pub fn empty_slots(&self, setup: &Setup, program: ProgramId, today: Date, window_days: u16) -> Vec<(ServiceId, Date, Role)> {
        self.window(setup, program, today, window_days)
            .filter(|(_, date, slot)| slot.filler.is_none() && self.turn_on(program, *date).is_some())
            .map(|(service, date, slot)| (service, date, slot.role))
            .collect()
    }

    /// Preachers filled in the next `window_days` whom the pastor has not
    /// approved: "sin aprobación del pastor".
    pub fn without_approval(
        &self,
        setup: &Setup,
        program: ProgramId,
        today: Date,
        window_days: u16,
    ) -> Vec<(ServiceId, Date, Role)> {
        self.window(setup, program, today, window_days)
            .filter(|(_, _, slot)| {
                slot.role.kind == RoleKind::Preaching
                    && slot.filler.is_some()
                    && slot.approval != Some(PastorApproval::Approved)
            })
            .map(|(service, date, slot)| (service, date, slot.role))
            .collect()
    }

    fn window(
        &self,
        setup: &Setup,
        program: ProgramId,
        today: Date,
        window_days: u16,
    ) -> impl Iterator<Item = (ServiceId, Date, Slot)> {
        let dates = match self.program(program) {
            Some(found) => service_dates(setup, found, today, today.plus_days(window_days.into())),
            None => Vec::new(),
        };
        dates.into_iter().flat_map(move |(service, date)| {
            let slots = self.slots_on(program, &service, date);
            slots.into_iter().map(move |slot| (service.clone(), date, slot))
        })
    }

    /// Every event that changed this role of this service on this date,
    /// oldest first, so each shows the value before it and who replaced it.
    pub fn history(&self, program: ProgramId, service: &ServiceId, date: Date, role: &str) -> Vec<&Recorded> {
        self.recorded(&Touched::Slot(program, service.clone(), date, role.to_owned()))
    }

    /// Every event that changed who holds this turn, oldest first.
    pub fn turn_history(&self, program: ProgramId, period: &Period) -> Vec<&Recorded> {
        self.recorded(&Touched::Turn(program, *period))
    }

    fn recorded(&self, key: &Touched) -> Vec<&Recorded> {
        self.touched.get(key).into_iter().flatten().map(|&at| &self.log[at]).collect()
    }

    /// Whether `actor` may record `event` on `today`. The developer may
    /// record anything. A charge serving today in the office that owns the
    /// work, or in a variant of it such as first elder for the elders, may
    /// record anything about it. Whoever holds a turn may also fill its
    /// roles and add roles to its dates. A charge that does not serve today
    /// may record nothing. This function is the whole rule.
    pub fn may_record(&self, setup: &Setup, today: Date, actor: &Actor, event: &RosterEvent) -> bool {
        let id = match actor {
            Actor::Developer => return true,
            Actor::Charge(id) => *id,
        };
        let year = church_year(today, setup.year_starts());
        let Some(charge) = setup.charges().iter().find(|c| c.id == id && c.serves_in(year, setup.charges())) else {
            return false;
        };
        let in_office = |office: &OfficeId| holds(setup, charge, office);
        let runs = |program: &ProgramId| self.program(*program).is_some_and(|p| in_office(&p.office));
        let in_turn = |program: &ProgramId, date: &Date| {
            runs(program) || self.turn_on(*program, *date) == Some(&Member::Charge(charge.id))
        };
        match event {
            RosterEvent::AddHelper { office, name: _, email: _ } => in_office(office),
            RosterEvent::EditHelper { helper, name: _, email: _, active: _ } => {
                self.helper(*helper).is_some_and(|h| in_office(&h.office))
            }
            RosterEvent::AddProgram { office, name: _, split: _, services: _ } => in_office(office),
            RosterEvent::EditProgram { program, name: _, split: _, services: _ }
            | RosterEvent::AssignTurn { program, period: _, member: _ }
            | RosterEvent::SendToPastor { program, year: _, month: _ }
            | RosterEvent::RecordPastorAnswer { program, service: _, date: _, role: _, approved: _, note: _ } => {
                runs(program)
            }
            RosterEvent::FillSlot { program, service: _, date, role: _, filler: _ }
            | RosterEvent::AddExtraRole { program, service: _, date, role: _ } => in_turn(program, date),
        }
    }
}

/// Whether `charge` is a charge of `office`, directly or as a variant.
fn holds(setup: &Setup, charge: &Charge, office: &OfficeId) -> bool {
    charge.office == *office || setup.catalog().office(&charge.office).and_then(|o| o.variant_of.as_ref()) == Some(office)
}

/// Each date from `from` through `to` that one of the program's services
/// falls on, in date order, then in the program's order of services.
fn service_dates(setup: &Setup, program: &Program, from: Date, to: Date) -> Vec<(ServiceId, Date)> {
    let mut dates: Vec<(ServiceId, Date)> = program
        .services
        .iter()
        .filter_map(|listed| setup.services().iter().find(|s| s.id == listed.service))
        .flat_map(|service| {
            let first = (0..7).map(|n| from.plus_days(n)).find(|d| d.weekday() == service.weekday).unwrap_or(from);
            std::iter::successors(Some(first), |d| Some(d.plus_days(7)))
                .take_while(|d| *d <= to)
                .map(|date| (service.id.clone(), date))
        })
        .collect();
    dates.sort_by_key(|(_, date)| *date);
    dates
}

fn listed_once(services: &[ProgramService]) -> Result<(), RosterError> {
    match services.iter().enumerate().find(|(i, s)| services[..*i].iter().any(|t| t.service == s.service)) {
        Some((_, repeated)) => Err(RosterError::RepeatedService(repeated.service.clone())),
        None => Ok(()),
    }
}

fn clean_email(email: &Option<String>) -> Option<String> {
    email.as_deref().map(normalize_email).filter(|e| !e.is_empty())
}

/// What `apply` checks against the setup, and only there, never on replay.
/// Destructured in full, so a new field that names something is checked.
fn check(setup: &Setup, recorded: &Recorded) -> Result<(), RosterError> {
    let Recorded { at: _, by, event } = recorded;
    let charge = |id: ChargeId| match setup.charges().iter().any(|c| c.id == id) {
        true => Ok(()),
        false => Err(RosterError::UnknownCharge(id)),
    };
    let office = |id: &OfficeId| match setup.catalog().office(id) {
        Some(_) => Ok(()),
        None => Err(RosterError::UnknownOffice(id.clone())),
    };
    let service = |id: &ServiceId| match setup.services().iter().any(|s| s.id == *id) {
        true => Ok(()),
        false => Err(RosterError::UnknownService(id.clone())),
    };
    if let Actor::Charge(id) = by {
        charge(*id)?;
    }
    match event {
        RosterEvent::AddHelper { office: o, name: _, email: _ } => office(o),
        RosterEvent::AddProgram { office: o, name: _, split: _, services } => {
            office(o)?;
            services.iter().try_for_each(|s| service(&s.service))
        }
        RosterEvent::EditProgram { program: _, name: _, split: _, services } => {
            services.iter().try_for_each(|s| service(&s.service))
        }
        RosterEvent::AssignTurn { program: _, period: _, member: Some(Member::Charge(id)) }
        | RosterEvent::FillSlot {
            program: _,
            service: _,
            date: _,
            role: _,
            filler: Some(Filler::Member(Member::Charge(id))),
        } => charge(*id),
        RosterEvent::EditHelper { helper: _, name: _, email: _, active: _ }
        | RosterEvent::AssignTurn { program: _, period: _, member: _ }
        | RosterEvent::FillSlot { program: _, service: _, date: _, role: _, filler: _ }
        | RosterEvent::AddExtraRole { program: _, service: _, date: _, role: _ }
        | RosterEvent::SendToPastor { program: _, year: _, month: _ }
        | RosterEvent::RecordPastorAnswer { program: _, service: _, date: _, role: _, approved: _, note: _ } => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RosterError {
    UnknownProgram(ProgramId),
    UnknownHelper(HelperId),
    UnknownCharge(ChargeId),
    UnknownService(ServiceId),
    UnknownOffice(OfficeId),
    /// The program does not hold that service.
    ServiceNotInProgram { program: ProgramId, service: ServiceId },
    /// A program lists each service once, with one list of roles.
    RepeatedService(ServiceId),
    /// Neither in the service's roles nor added for that date.
    UnknownRole { program: ProgramId, service: ServiceId, date: Date, role: String },
    /// The pastor answers only for preachers.
    NotPreaching { program: ProgramId, role: String },
}

impl fmt::Display for RosterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownProgram(id) => write!(f, "there is no program {}", id.0),
            Self::UnknownHelper(id) => write!(f, "there is no helper {}", id.0),
            Self::UnknownCharge(id) => write!(f, "charge {} is not held", id.0),
            Self::UnknownService(id) => write!(f, "the church holds no service {}", id.0),
            Self::UnknownOffice(id) => write!(f, "the catalog has no office {}", id.0),
            Self::ServiceNotInProgram { program, service } => {
                write!(f, "program {} does not hold service {}", program.0, service.0)
            }
            Self::RepeatedService(id) => write!(f, "service {} is listed twice", id.0),
            Self::UnknownRole { program, service, date, role } => {
                write!(f, "program {} has no role {role} on service {} of {date}", program.0, service.0)
            }
            Self::NotPreaching { program, role } => {
                write!(f, "role {role} of program {} is not preaching, so the pastor does not answer for it", program.0)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::Change;
    use crate::{Holder, NewCharge, Term};

    const ELENA: ChargeId = ChargeId(1);
    const PEDRO: ChargeId = ChargeId(2);
    const LUIS: ChargeId = ChargeId(3);
    const MARTA: ChargeId = ChargeId(4);
    const JUAN: ChargeId = ChargeId(5);
    const ELDERS: ProgramId = ProgramId(1);
    const YOUTH: ProgramId = ProgramId(2);
    const SABBATH: &str = "culto-divino";
    const SUNDAY: &str = "culto-de-la-noche";
    const WEDNESDAY: &str = "culto-de-oracion";
    const YOUTH_SOCIETY: &str = "jovenes";
    const PREACHER: &str = "Predicador";
    const MEDITATION: &str = "Meditación";
    const TODAY: Date = Date { year: 2026, month: Month(11), day: 27 };

    fn day(year: u16, month: u8, day: u8) -> Date {
        Date { year, month: Month(month), day }
    }

    fn service(id: &str) -> ServiceId {
        ServiceId::from(id)
    }

    /// An elder, the first elder, the treasurer, the youth director and the
    /// head deacon, with the elders' three services and the youth society.
    fn setup() -> Setup {
        let held = |office: &str, name: &str| NewCharge {
            office: OfficeId::from(office),
            holder: Holder { name: name.into(), email: None },
            term: Term::one_year(2026),
        };
        let places = r#"[{"id":"templo","name":"Templo","kind":"own"}]"#;
        let services = r#"[{"id":"culto-divino","name":"Culto divino","weekday":"saturday","time":"11:00","place":"templo"},
                           {"id":"culto-de-la-noche","name":"Culto de la noche","weekday":"sunday","time":"19:00","place":"templo"},
                           {"id":"culto-de-oracion","name":"Culto de oración","weekday":"wednesday","time":"19:00","place":"templo"},
                           {"id":"jovenes","name":"Sociedad de Jóvenes","weekday":"saturday","time":"15:30","place":"templo"}]"#;
        Setup::initial(&Change {
            church: Some("Iglesia".into()),
            places: Some(serde_json::from_str(places).unwrap()),
            services: Some(serde_json::from_str(services).unwrap()),
            elect: vec![
                held("anciano", "Elena"),
                held("primer-anciano", "Pedro"),
                held("tesorero", "Luis"),
                held("ministerio-joven", "Marta"),
                held("jefe-de-diaconos", "Juan"),
            ],
            ..Change::default()
        })
        .unwrap()
    }

    struct Church {
        setup: Setup,
        roster: Roster,
        events: Vec<Recorded>,
    }

    impl Church {
        /// With the elders' services by month, each with its suggested
        /// roles, and the youth society by Sabbath.
        fn new() -> Self {
            let mut church = Self { setup: setup(), roster: Roster::default(), events: Vec::new() };
            let elders = [SABBATH, SUNDAY, WEDNESDAY]
                .map(|id| ProgramService { service: service(id), roles: suggested_roles(church.service(id)) });
            church.by(PEDRO, add_program("anciano", "Cultos del anciano", Split::ByMonth, elders.into()));
            let youth = listed(YOUTH_SOCIETY, &[("Bienvenida", RoleKind::Normal), ("Himno especial", RoleKind::Normal)]);
            church.by(MARTA, add_program("ministerio-joven", "Sociedad de Jóvenes", Split::ByDate, vec![youth]));
            church
        }

        fn service(&self, id: &str) -> &Service {
            self.setup.services().iter().find(|s| s.id == service(id)).unwrap()
        }

        fn record(&mut self, by: Actor, event: RosterEvent) -> Result<(), RosterError> {
            let recorded = Recorded { at: "2026-11-27T05:32:43Z".into(), by, event };
            self.roster.apply(&self.setup, recorded.clone())?;
            self.events.push(recorded);
            Ok(())
        }

        fn by(&mut self, charge: ChargeId, event: RosterEvent) {
            self.record(Actor::Charge(charge), event).unwrap();
        }

        fn may(&self, charge: ChargeId, event: &RosterEvent) -> bool {
            self.roster.may_record(&self.setup, TODAY, &Actor::Charge(charge), event)
        }

        fn approval(&self, program: ProgramId, on: &str, date: Date, role: &str) -> Option<PastorApproval> {
            self.slot(program, on, date, role).and_then(|s| s.approval)
        }

        fn slot(&self, program: ProgramId, on: &str, date: Date, role: &str) -> Option<Slot> {
            self.roster.slots_on(program, &service(on), date).into_iter().find(|s| s.role.name == role)
        }

        fn role_names(&self, program: ProgramId, on: &str, date: Date) -> Vec<String> {
            self.roster.slots_on(program, &service(on), date).into_iter().map(|s| s.role.name).collect()
        }
    }

    fn roles(roles: &[(&str, RoleKind)]) -> Vec<Role> {
        roles.iter().map(|&(name, kind)| Role { name: name.into(), kind }).collect()
    }

    fn listed(on: &str, with: &[(&str, RoleKind)]) -> ProgramService {
        ProgramService { service: service(on), roles: roles(with) }
    }

    fn add_program(office: &str, name: &str, split: Split, services: Vec<ProgramService>) -> RosterEvent {
        RosterEvent::AddProgram { office: office.into(), name: name.into(), split, services }
    }

    fn assign(program: ProgramId, period: Period, member: Member) -> RosterEvent {
        RosterEvent::AssignTurn { program, period, member: Some(member) }
    }

    fn month(year: u16, month: u8) -> Period {
        Period::Month { year, month: Month(month) }
    }

    fn fill(program: ProgramId, on: &str, date: Date, role: &str, filler: Filler) -> RosterEvent {
        RosterEvent::FillSlot { program, service: service(on), date, role: role.into(), filler: Some(filler) }
    }

    fn guest(name: &str) -> Filler {
        Filler::Name(name.into())
    }

    /// The pastor's answer about the Sabbath preacher on `date`.
    fn answer(date: Date, approved: bool, note: Option<&str>) -> RosterEvent {
        RosterEvent::RecordPastorAnswer {
            program: ELDERS,
            service: service(SABBATH),
            date,
            role: PREACHER.into(),
            approved,
            note: note.map(Into::into),
        }
    }

    fn send(year: u16, month: u8) -> RosterEvent {
        RosterEvent::SendToPastor { program: ELDERS, year, month: Month(month) }
    }

    #[test]
    fn unassigned_months_inside_the_window_show_up_and_assigned_ones_do_not() {
        let mut church = Church::new();
        church.by(ELENA, assign(ELDERS, month(2026, 12), Member::Charge(ELENA)));
        assert_eq!(church.roster.unassigned(&church.setup, ELDERS, TODAY, 40), [month(2026, 11), month(2027, 1)]);
    }

    #[test]
    fn by_date_periods_fall_on_the_service_weekday() {
        let church = Church::new();
        let december = church.roster.periods(&church.setup, YOUTH, day(2026, 12, 1), day(2026, 12, 31));
        assert_eq!(december, [5, 12, 19, 26].map(|d| Period::Date(day(2026, 12, d))));
    }

    #[test]
    fn by_date_periods_of_a_sabbath_and_wednesday_program_include_both_weekdays() {
        let mut church = Church::new();
        let services = vec![listed(SABBATH, &[(PREACHER, RoleKind::Preaching)]), listed(WEDNESDAY, &[(MEDITATION, RoleKind::Preaching)])];
        church.by(PEDRO, add_program("anciano", "Predicación", Split::ByDate, services));
        let december = church.roster.periods(&church.setup, ProgramId(3), day(2026, 12, 1), day(2026, 12, 31));
        assert_eq!(december, [2, 5, 9, 12, 16, 19, 23, 26, 30].map(|d| Period::Date(day(2026, 12, d))));
    }

    #[test]
    fn one_months_turn_covers_every_service_of_the_program() {
        let mut church = Church::new();
        church.by(PEDRO, assign(ELDERS, month(2026, 12), Member::Charge(LUIS)));
        for (on, date, role) in
            [(WEDNESDAY, day(2026, 12, 2), MEDITATION), (SABBATH, day(2026, 12, 5), PREACHER), (SUNDAY, day(2026, 12, 6), PREACHER)]
        {
            assert!(church.may(LUIS, &fill(ELDERS, on, date, role, guest("Ana"))), "Luis holds {on} on {date}");
        }
        assert!(!church.may(LUIS, &fill(ELDERS, SABBATH, day(2027, 1, 2), PREACHER, guest("Ana"))), "January is not his");
        let mut open: Vec<_> = church
            .roster
            .empty_slots(&church.setup, ELDERS, TODAY, 14)
            .into_iter()
            .map(|(on, date, _)| (on, date))
            .collect();
        open.dedup();
        let december = [(WEDNESDAY, 2), (SABBATH, 5), (SUNDAY, 6), (WEDNESDAY, 9)].map(|(on, d)| (service(on), day(2026, 12, d)));
        assert_eq!(open, december, "November's services have nobody to fill them");
    }

    #[test]
    fn each_service_keeps_its_own_roles_and_editing_one_leaves_the_others() {
        let mut church = Church::new();
        let sabbath = church.role_names(ELDERS, SABBATH, day(2026, 12, 5));
        assert_eq!(sabbath.len(), 7);
        assert_eq!(church.role_names(ELDERS, SUNDAY, day(2026, 12, 6)), [PREACHER]);
        assert_eq!(church.role_names(ELDERS, WEDNESDAY, day(2026, 12, 2)), [MEDITATION]);
        let Program { name, split, mut services, .. } = church.roster.program(ELDERS).unwrap().clone();
        let wednesday = services.iter_mut().find(|s| s.service == service(WEDNESDAY)).unwrap();
        wednesday.roles = roles(&[(MEDITATION, RoleKind::Normal), ("Himno", RoleKind::Normal)]);
        church.by(ELENA, RosterEvent::EditProgram { program: ELDERS, name, split, services });
        assert_eq!(church.role_names(ELDERS, WEDNESDAY, day(2026, 12, 2)), [MEDITATION, "Himno"]);
        assert_eq!(church.slot(ELDERS, WEDNESDAY, day(2026, 12, 2), MEDITATION).unwrap().role.kind, RoleKind::Normal);
        assert_eq!(church.role_names(ELDERS, SABBATH, day(2026, 12, 5)), sabbath);
        assert_eq!(church.role_names(ELDERS, SUNDAY, day(2026, 12, 6)), [PREACHER]);
    }

    #[test]
    fn suggested_roles_follow_the_manuals_sabbath_order_and_wednesdays_meditation_needs_the_pastor() {
        let mut church = Church::new();
        let sabbath = [
            (PREACHER, RoleKind::Preaching),
            ("Anuncios", RoleKind::Normal),
            ("Invocación", RoleKind::Normal),
            ("Lectura bíblica", RoleKind::Normal),
            ("Oración", RoleKind::Normal),
            ("Diezmos y ofrendas", RoleKind::Normal),
            ("Música especial", RoleKind::Normal),
        ];
        assert_eq!(suggested_roles(church.service(SABBATH)), roles(&sabbath));
        assert_eq!(suggested_roles(church.service(SUNDAY)), roles(&[(PREACHER, RoleKind::Preaching)]));
        assert_eq!(suggested_roles(church.service(WEDNESDAY)), roles(&[(MEDITATION, RoleKind::Preaching)]));
        let friday = Service { weekday: Weekday::Friday, ..church.service(SABBATH).clone() };
        assert_eq!(suggested_roles(&friday), []);

        church.by(ELENA, fill(ELDERS, WEDNESDAY, day(2026, 12, 2), MEDITATION, guest("Hna. Pérez")));
        assert_eq!(church.approval(ELDERS, WEDNESDAY, day(2026, 12, 2), MEDITATION), Some(PastorApproval::Proposed));
        let pending = church.roster.without_approval(&church.setup, ELDERS, TODAY, 14);
        assert_eq!(pending, [(service(WEDNESDAY), day(2026, 12, 2), Role { name: MEDITATION.into(), kind: RoleKind::Preaching })]);
    }

    #[test]
    fn an_assigned_turns_empty_roles_are_its_holders_to_do() {
        let mut church = Church::new();
        church.by(MARTA, assign(YOUTH, Period::Date(day(2026, 12, 5)), Member::Charge(JUAN)));
        church.by(JUAN, fill(YOUTH, YOUTH_SOCIETY, day(2026, 12, 5), "Bienvenida", Filler::Member(Member::Charge(JUAN))));
        let open = church.roster.empty_slots(&church.setup, YOUTH, TODAY, 14);
        let open: Vec<_> = open.iter().map(|(_, date, role)| (*date, role.name.as_str())).collect();
        assert_eq!(open, [(day(2026, 12, 5), "Himno especial")], "Nov 28 and Dec 12 have nobody to fill them");
    }

    #[test]
    fn filling_a_preaching_role_proposes_it() {
        let mut church = Church::new();
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Proposed));
    }

    #[test]
    fn sending_the_month_moves_only_that_months_proposed_slots_on_every_service() {
        let mut church = Church::new();
        for date in [day(2026, 12, 5), day(2026, 12, 12), day(2027, 1, 2)] {
            church.by(ELENA, fill(ELDERS, SABBATH, date, PREACHER, guest("Pr. Gómez")));
        }
        church.by(ELENA, fill(ELDERS, WEDNESDAY, day(2026, 12, 9), MEDITATION, guest("Hna. Pérez")));
        church.by(ELENA, answer(day(2026, 12, 12), true, None));
        church.by(PEDRO, send(2026, 12));
        let states = [day(2026, 12, 5), day(2026, 12, 12), day(2027, 1, 2)].map(|d| church.approval(ELDERS, SABBATH, d, PREACHER));
        assert_eq!(
            states,
            [Some(PastorApproval::WithPastor), Some(PastorApproval::Approved), Some(PastorApproval::Proposed)]
        );
        assert_eq!(church.approval(ELDERS, WEDNESDAY, day(2026, 12, 9), MEDITATION), Some(PastorApproval::WithPastor));
    }

    #[test]
    fn a_not_approved_answer_empties_the_slot_and_keeps_the_note() {
        let mut church = Church::new();
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, send(2026, 12));
        church.by(ELENA, answer(day(2026, 12, 5), false, Some("Ya predicó en noviembre")));
        let slot = church.slot(ELDERS, SABBATH, day(2026, 12, 5), PREACHER).unwrap();
        assert_eq!(slot.filler, None);
        assert_eq!(slot.approval, Some(PastorApproval::NotApproved { note: "Ya predicó en noviembre".into() }));
    }

    #[test]
    fn an_answer_recorded_without_sending_is_accepted() {
        let mut church = Church::new();
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        assert_eq!(church.record(Actor::Charge(ELENA), answer(day(2026, 12, 5), true, None)), Ok(()));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Approved));
    }

    #[test]
    fn filling_a_preacher_while_with_the_pastor_is_accepted_and_proposes_again() {
        let mut church = Church::new();
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, send(2026, 12));
        let refill = fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Ruiz"));
        assert_eq!(church.record(Actor::Charge(ELENA), refill), Ok(()));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Proposed));
    }

    #[test]
    fn a_filled_preacher_reads_as_without_approval_until_the_pastor_approves() {
        let mut church = Church::new();
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        let pending = |church: &Church| church.roster.without_approval(&church.setup, ELDERS, TODAY, 14);
        let preacher = Role { name: PREACHER.into(), kind: RoleKind::Preaching };
        assert_eq!(pending(&church), [(service(SABBATH), day(2026, 12, 5), preacher)]);
        church.by(ELENA, answer(day(2026, 12, 5), true, None));
        assert_eq!(pending(&church), []);
    }

    #[test]
    fn an_extra_role_exists_only_on_its_date() {
        let mut church = Church::new();
        let duet = Role { name: "Dúo".into(), kind: RoleKind::Normal };
        let add = RosterEvent::AddExtraRole { program: YOUTH, service: service(YOUTH_SOCIETY), date: day(2026, 12, 12), role: duet };
        church.by(MARTA, add);
        assert_eq!(church.slot(YOUTH, YOUTH_SOCIETY, day(2026, 12, 12), "Dúo").map(|s| s.extra), Some(true));
        assert_eq!(church.slot(YOUTH, YOUTH_SOCIETY, day(2026, 12, 19), "Dúo"), None);
        let elsewhere = church.record(Actor::Charge(MARTA), fill(YOUTH, YOUTH_SOCIETY, day(2026, 12, 19), "Dúo", guest("Ana")));
        let unknown = RosterError::UnknownRole { program: YOUTH, service: service(YOUTH_SOCIETY), date: day(2026, 12, 19), role: "Dúo".into() };
        assert_eq!(elsewhere, Err(unknown));
    }

    #[test]
    fn an_extra_role_on_sunday_does_not_appear_on_the_sabbath() {
        let mut church = Church::new();
        let duet = Role { name: "Dúo".into(), kind: RoleKind::Normal };
        church.by(ELENA, RosterEvent::AddExtraRole { program: ELDERS, service: service(SUNDAY), date: day(2026, 12, 6), role: duet });
        assert_eq!(church.slot(ELDERS, SUNDAY, day(2026, 12, 6), "Dúo").map(|s| s.extra), Some(true));
        assert_eq!(church.slot(ELDERS, SABBATH, day(2026, 12, 5), "Dúo"), None);
        assert_eq!(church.slot(ELDERS, SABBATH, day(2026, 12, 6), "Dúo"), None, "the same date on another service");
        let on_sabbath = church.record(Actor::Charge(ELENA), fill(ELDERS, SABBATH, day(2026, 12, 5), "Dúo", guest("Ana")));
        let unknown = RosterError::UnknownRole { program: ELDERS, service: service(SABBATH), date: day(2026, 12, 5), role: "Dúo".into() };
        assert_eq!(on_sabbath, Err(unknown));
    }

    #[test]
    fn a_turns_holder_fills_its_roles_an_outsider_does_not_and_the_office_fills_a_helpers_turn() {
        let mut church = Church::new();
        church.by(MARTA, RosterEvent::AddHelper { office: "ministerio-joven".into(), name: "Rosa".into(), email: None });
        church.by(MARTA, assign(YOUTH, Period::Date(day(2026, 12, 5)), Member::Charge(JUAN)));
        church.by(MARTA, assign(YOUTH, Period::Date(day(2026, 12, 12)), Member::Helper(HelperId(1))));
        let on = |date: Date| fill(YOUTH, YOUTH_SOCIETY, date, "Bienvenida", guest("Ana"));
        let (juans, rosas) = (on(day(2026, 12, 5)), on(day(2026, 12, 12)));
        assert!(church.may(JUAN, &juans), "Juan holds Dec 5");
        assert!(!church.may(JUAN, &rosas), "Rosa holds Dec 12");
        assert!(!church.may(LUIS, &juans), "the treasurer holds no turn and no youth charge");
        assert!(church.may(MARTA, &rosas), "the youth director fills a helper's turn for her");
        assert!(!church.may(JUAN, &assign(YOUTH, Period::Date(day(2026, 12, 19)), Member::Charge(JUAN))), "a turn holder does not split the turns");
    }

    #[test]
    fn every_elder_may_assign_the_elders_months_and_a_treasurer_may_not() {
        let church = Church::new();
        let december = assign(ELDERS, month(2026, 12), Member::Charge(ELENA));
        let who = [ELENA, PEDRO, LUIS].map(|charge| church.may(charge, &december));
        assert_eq!(who, [true, true, false]);
        assert!(church.roster.may_record(&church.setup, TODAY, &Actor::Developer, &december));
    }

    #[test]
    fn an_unknown_program_is_refused() {
        let mut church = Church::new();
        let refused = church.record(Actor::Charge(ELENA), fill(ProgramId(9), SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        assert_eq!(refused, Err(RosterError::UnknownProgram(ProgramId(9))));
    }

    #[test]
    fn only_names_of_things_that_do_not_exist_are_refused() {
        let mut church = Church::new();
        for (case, by, event, error) in [
            ("unknown helper", PEDRO, assign(ELDERS, month(2026, 12), Member::Helper(HelperId(7))), RosterError::UnknownHelper(HelperId(7))),
            ("unknown charge", PEDRO, assign(ELDERS, month(2026, 12), Member::Charge(ChargeId(40))), RosterError::UnknownCharge(ChargeId(40))),
            (
                "unknown office",
                PEDRO,
                add_program("obispo", "X", Split::ByMonth, vec![listed(SABBATH, &[])]),
                RosterError::UnknownOffice("obispo".into()),
            ),
            (
                "unknown service",
                PEDRO,
                add_program("anciano", "X", Split::ByMonth, vec![listed(SABBATH, &[]), listed("vigilia", &[])]),
                RosterError::UnknownService("vigilia".into()),
            ),
            (
                "service the program does not hold",
                MARTA,
                fill(YOUTH, SABBATH, day(2026, 12, 5), "Bienvenida", guest("Ana")),
                RosterError::ServiceNotInProgram { program: YOUTH, service: service(SABBATH) },
            ),
            (
                "unknown role",
                PEDRO,
                fill(ELDERS, SABBATH, day(2026, 12, 5), "Diácono", guest("Ana")),
                RosterError::UnknownRole { program: ELDERS, service: service(SABBATH), date: day(2026, 12, 5), role: "Diácono".into() },
            ),
        ] {
            assert_eq!(church.record(Actor::Charge(by), event), Err(error), "{case}");
        }
        let unknown_actor = church.record(Actor::Charge(ChargeId(40)), send(2026, 12));
        assert_eq!(unknown_actor, Err(RosterError::UnknownCharge(ChargeId(40))));
        assert_eq!(church.roster, Roster::replay(&church.events).unwrap(), "a refused event leaves no trace");
    }

    #[test]
    fn a_program_may_hold_no_service_but_not_the_same_service_twice() {
        let mut church = Church::new();
        assert_eq!(church.record(Actor::Charge(PEDRO), add_program("anciano", "Visitación", Split::ByMonth, vec![])), Ok(()));
        assert_eq!(church.roster.periods(&church.setup, ProgramId(3), day(2026, 12, 1), day(2026, 12, 31)), []);
        let twice = vec![listed(SABBATH, &[]), listed(SUNDAY, &[]), listed(SABBATH, &[])];
        let refused = church.record(Actor::Charge(PEDRO), add_program("anciano", "X", Split::ByMonth, twice.clone()));
        assert_eq!(refused, Err(RosterError::RepeatedService(service(SABBATH))));
        let edit = RosterEvent::EditProgram { program: ELDERS, name: "X".into(), split: Split::ByMonth, services: twice };
        assert_eq!(church.record(Actor::Charge(PEDRO), edit), Err(RosterError::RepeatedService(service(SABBATH))));
        assert_eq!(church.roster, Roster::replay(&church.events).unwrap(), "a refused event leaves no trace");
    }

    #[test]
    fn replay_of_the_same_events_gives_the_same_roster() {
        let mut church = Church::new();
        let rosa = Some(" Rosa@Example.org".into());
        church.by(MARTA, RosterEvent::AddHelper { office: "ministerio-joven".into(), name: " Rosa ".into(), email: rosa });
        church.by(ELENA, assign(ELDERS, month(2026, 12), Member::Charge(ELENA)));
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, fill(ELDERS, WEDNESDAY, day(2026, 12, 2), MEDITATION, guest("Hna. Pérez")));
        church.by(ELENA, send(2026, 12));
        church.by(ELENA, answer(day(2026, 12, 5), false, Some("Otra fecha")));
        church.by(MARTA, assign(YOUTH, Period::Date(day(2026, 12, 12)), Member::Helper(HelperId(1))));
        let duet = Role { name: "Dúo".into(), kind: RoleKind::Normal };
        church.by(MARTA, RosterEvent::AddExtraRole { program: YOUTH, service: service(YOUTH_SOCIETY), date: day(2026, 12, 12), role: duet });
        church.by(MARTA, RosterEvent::AssignTurn { program: YOUTH, period: Period::Date(day(2026, 12, 12)), member: None });
        assert_eq!(Roster::replay(&church.events).unwrap(), church.roster);
    }

    #[test]
    fn history_lists_previous_fillers_with_who_changed_them() {
        let mut church = Church::new();
        let dec5 = day(2026, 12, 5);
        church.by(ELENA, fill(ELDERS, SABBATH, dec5, PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 12), PREACHER, guest("Pr. Ruiz")));
        church.by(ELENA, fill(ELDERS, SUNDAY, day(2026, 12, 6), PREACHER, guest("Pr. Ruiz")));
        church.by(PEDRO, fill(ELDERS, SABBATH, dec5, PREACHER, Filler::Member(Member::Charge(ELENA))));
        church.by(PEDRO, send(2026, 12));
        let history: Vec<(Actor, &RosterEvent)> =
            church.roster.history(ELDERS, &service(SABBATH), dec5, PREACHER).into_iter().map(|r| (r.by, &r.event)).collect();
        assert_eq!(
            history,
            [
                (Actor::Charge(ELENA), &fill(ELDERS, SABBATH, dec5, PREACHER, guest("Pr. Gómez"))),
                (Actor::Charge(PEDRO), &fill(ELDERS, SABBATH, dec5, PREACHER, Filler::Member(Member::Charge(ELENA)))),
                (Actor::Charge(PEDRO), &send(2026, 12)),
            ]
        );
    }
}
