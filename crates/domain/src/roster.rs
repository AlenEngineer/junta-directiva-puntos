//! A department's recurring work. A program repeats on one or more of the
//! church's regular services and is split into turns (by month or by
//! service date) among the office's team. Whoever holds a turn, alone or
//! with others, leads every service of the program in it and fills each
//! service's roles.
//!
//! The roster is never stored. Its history is: one `Recorded` event per
//! change, and `Roster` replays it. The process is never blocked: a turn
//! left empty, a preacher filled before the pastor answers, an answer
//! recorded out of order or a speaker from outside the district the pastor
//! has not heard about is a state the queries report, not a refusal, and so
//! is a role two programs both assign, songs written for a service that
//! keeps no song list, a turn with more or fewer holders than the program
//! expects, or an off role someone fills. Only input that names something
//! that does not exist, or a program that lists one service twice, is
//! refused.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::catalog::OfficeId;
use crate::schedule::{Service, ServiceId, ServiceKind};
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
    /// How many people each turn expects, such as the two a cargo of a
    /// Sabbath at Sabbath School.
    #[serde(default = "one")]
    pub holders: u8,
    #[serde(default)]
    pub period: SheetPeriod,
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
    /// Keeps a list of what is sung on each date ("qué se canta").
    #[serde(default)]
    pub songs: bool,
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

/// What one printed sheet of a program covers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SheetPeriod {
    #[default]
    Month,
    /// A calendar quarter: January to March, April to June, July to
    /// September, October to December.
    Quarter,
}

impl SheetPeriod {
    /// The first and last day of the sheet `date` falls on.
    pub fn range(self, date: Date) -> (Date, Date) {
        match self {
            Self::Month => (Date::first_of(date.year, date.month), Date::last_of(date.year, date.month)),
            Self::Quarter => {
                let first = (date.month.0 - 1) / 3 * 3 + 1;
                (Date::first_of(date.year, Month(first)), Date::last_of(date.year, Month(first + 2)))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Role {
    pub name: String,
    pub kind: RoleKind,
    /// An off role stays in the list for the office to turn on again; it
    /// asks nobody to fill it and has no row on the sheet.
    #[serde(default = "yes")]
    pub on: bool,
}

fn yes() -> bool {
    true
}

fn one() -> u8 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoleKind {
    Normal,
    /// Who preaches or gives the reflection. With `pastor_approves` the
    /// elder records the pastor's approval; without it, the elder tells the
    /// pastor when the speaker comes from outside the district.
    Pulpit { pastor_approves: bool },
}

/// A program Mayordomo offers an office to start from. It is only a
/// suggestion: the office edits the program it adds, and `apply` never
/// reads a template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramTemplate {
    pub name: String,
    pub office: OfficeId,
    pub split: Split,
    pub holders: u8,
    pub period: SheetPeriod,
    pub services: Vec<TemplateService>,
}

/// The roles a template gives each of the church's services of `kind`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateService {
    pub kind: ServiceKind,
    pub roles: Vec<Role>,
    pub songs: bool,
}


impl ProgramTemplate {
    /// The program this template makes on the church's `services`: each
    /// service whose kind the template covers, in the template's order. A
    /// kind the church holds no service of is left out.
    pub fn add_program(&self, services: &[Service]) -> RosterEvent {
        let services = self
            .services
            .iter()
            .flat_map(|t| {
                services.iter().filter(move |s| s.kind == t.kind).map(move |s| ProgramService {
                    service: s.id.clone(),
                    roles: t.roles.clone(),
                    songs: t.songs,
                })
            })
            .collect();
        RosterEvent::AddProgram {
            office: self.office.clone(),
            name: self.name.clone(),
            split: self.split,
            holders: self.holders,
            period: self.period,
            services,
        }
    }
}

/// The programs offered to start from. Nobody leads by role, the turn's
/// holders do, so the singers have no leader and Sabbath School's "A cargo"
/// is its turn. The elders' divine service follows the order of worship in
/// the Church Manual, p. 229; its "Música especial" is the elder's to choose.
/// At Sabbath School only those a cargo are named and they hand out the
/// rest, so only the mission story and Nuevo Horizonte start on.
pub fn templates() -> Vec<ProgramTemplate> {
    let speaker = RoleKind::Pulpit { pastor_approves: false };
    let reflection = || roles(&[("Reflexión", speaker)]);
    let divine_service = roles(&[
        ("Predicador", speaker),
        ("Anuncios", RoleKind::Normal),
        ("Invocación", RoleKind::Normal),
        ("Lectura bíblica", RoleKind::Normal),
        ("Oración", RoleKind::Normal),
        ("Diezmos y ofrendas", RoleKind::Normal),
        ("Música especial", RoleKind::Normal),
    ]);
    let on = |kind, roles, songs| TemplateService { kind, roles, songs };
    let mut sabbath_school = roles(&[
        ("Misionero", RoleKind::Normal),
        ("Nuevo Horizonte", RoleKind::Normal),
        ("Oración", RoleKind::Normal),
        ("Lectura bíblica", RoleKind::Normal),
        ("Himno", RoleKind::Normal),
        ("Especial", RoleKind::Normal),
    ]);
    for role in &mut sabbath_school[2..] {
        role.on = false;
    }
    // As on the operator's sample sheet: three at Sabbath School, two elsewhere.
    let sing = |kind, n, songs| on(kind, singers(n), songs);
    vec![
        ProgramTemplate {
            name: "Cultos del anciano".into(),
            office: "anciano".into(),
            split: Split::ByMonth,
            holders: 1,
            period: SheetPeriod::Month,
            services: vec![
                on(ServiceKind::DivineService, divine_service, false),
                on(ServiceKind::SundayNight, reflection(), false),
                on(ServiceKind::PrayerMeeting, reflection(), false),
            ],
        },
        ProgramTemplate {
            name: "Servicio de canto".into(),
            office: "musica".into(),
            split: Split::ByMonth,
            holders: 1,
            period: SheetPeriod::Month,
            services: vec![
                sing(ServiceKind::SabbathSchool, 3, true),
                sing(ServiceKind::DivineService, 2, false),
                sing(ServiceKind::SundayNight, 2, false),
                sing(ServiceKind::PrayerMeeting, 2, false),
            ],
        },
        ProgramTemplate {
            name: "Escuela Sabática".into(),
            office: "escuela-sabatica".into(),
            split: Split::ByDate,
            holders: 2,
            period: SheetPeriod::Quarter,
            services: vec![on(ServiceKind::SabbathSchool, sabbath_school, false)],
        },
    ]
}

/// "Cantante 1" through "Cantante `n`". The head changes how many sing on a
/// service by editing its roles.
pub fn singers(n: u8) -> Vec<Role> {
    (1..=n).map(|i| Role { name: format!("Cantante {i}"), kind: RoleKind::Normal, on: true }).collect()
}

fn roles(roles: &[(&str, RoleKind)]) -> Vec<Role> {
    roles.iter().map(|&(name, kind)| Role { name: name.into(), kind, on: true }).collect()
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

/// The way to the pulpit of a role the pastor approves: proposed by the elder, sent to the
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
    /// Only ever on a pulpit role the pastor approves.
    pub approval: Option<PastorApproval>,
    /// Only ever on a pulpit role the pastor does not approve.
    pub from_outside_district: bool,
    /// When the elder told the pastor about a speaker from outside the
    /// district. Only ever on a pulpit role the pastor does not approve.
    pub pastor_notified: Option<Date>,
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
    AddProgram {
        office: OfficeId,
        name: String,
        split: Split,
        #[serde(default = "one")]
        holders: u8,
        #[serde(default)]
        period: SheetPeriod,
        services: Vec<ProgramService>,
    },
    EditProgram {
        program: ProgramId,
        name: String,
        split: Split,
        #[serde(default = "one")]
        holders: u8,
        #[serde(default)]
        period: SheetPeriod,
        services: Vec<ProgramService>,
    },
    AssignTurn(Turn),
    /// `None` empties the role. Filling a pulpit role proposes it again,
    /// whatever the pastor said about the one before, and forgets any
    /// notice to the pastor.
    FillSlot {
        program: ProgramId,
        service: ServiceId,
        date: Date,
        role: String,
        filler: Option<Filler>,
        #[serde(default)]
        from_outside_district: bool,
    },
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
    /// The elder told the pastor, `on` that date, who comes from outside
    /// the district to fill the role.
    NotifyPastor { program: ProgramId, service: ServiceId, date: Date, role: String, on: Date },
    /// What is sung on the service that date, replacing the list before;
    /// an empty list clears it.
    SetSongs { program: ProgramId, service: ServiceId, date: Date, songs: Vec<String> },
}

/// One turn covers every service of the program in `period`, held by
/// `members` together. No members leaves the period without anyone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Turn {
    pub program: ProgramId,
    pub period: Period,
    pub members: Vec<Member>,
}

/// Also reads a turn stored before it had several holders, whose one
/// holder or null is under `member`. Written by hand because ts-rs cannot
/// parse the serde attributes that would say so.
impl<'de> Deserialize<'de> for Turn {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Stored {
            program: ProgramId,
            period: Period,
            #[serde(default)]
            members: Vec<Member>,
            #[serde(default)]
            member: Option<Member>,
        }
        let Stored { program, period, mut members, member } = Stored::deserialize(deserializer)?;
        members.extend(member);
        Ok(Self { program, period, members })
    }
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
    from_outside_district: bool,
    pastor_notified: Option<Date>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Touched {
    Turn(ProgramId, Period),
    Slot(ProgramId, ServiceId, Date, String),
    Songs(ProgramId, ServiceId, Date),
}

/// The roster a history adds up to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roster {
    helpers: Vec<Helper>,
    programs: Vec<Program>,
    /// A period with no entry has nobody.
    turns: BTreeMap<(ProgramId, Period), Vec<Member>>,
    slots: BTreeMap<(ProgramId, ServiceId, Date, String), SlotState>,
    extras: BTreeMap<(ProgramId, ServiceId, Date), Vec<Role>>,
    songs: BTreeMap<(ProgramId, ServiceId, Date), Vec<String>>,
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
            RosterEvent::AddProgram { office, name, split, holders, period, services } => {
                listed_once(services)?;
                let id = ProgramId(self.programs.len() as u32 + 1);
                self.programs.push(Program {
                    id,
                    office: office.clone(),
                    name: name.trim().to_owned(),
                    split: *split,
                    holders: *holders,
                    period: *period,
                    services: services.clone(),
                });
            }
            RosterEvent::EditProgram { program, name, split, holders, period, services } => {
                listed_once(services)?;
                let found =
                    self.programs.iter_mut().find(|p| p.id == *program).ok_or(RosterError::UnknownProgram(*program))?;
                found.name = name.trim().to_owned();
                found.split = *split;
                found.holders = *holders;
                found.period = *period;
                found.services = services.clone();
            }
            RosterEvent::AssignTurn(Turn { program, period, members }) => {
                self.known(*program)?;
                let mut held: Vec<Member> = Vec::new();
                for member in members {
                    if let Member::Helper(helper) = member {
                        self.known_helper(*helper)?;
                    }
                    if !held.contains(member) {
                        held.push(*member);
                    }
                }
                match held.is_empty() {
                    true => self.turns.remove(&(*program, *period)),
                    false => self.turns.insert((*program, *period), held),
                };
                touched.push(Touched::Turn(*program, *period));
            }
            RosterEvent::FillSlot { program, service, date, role, filler, from_outside_district } => {
                let kind = self.role_kind(*program, service, *date, role)?;
                if let Some(Filler::Member(Member::Helper(helper))) = filler {
                    self.known_helper(*helper)?;
                }
                let slot = self.slots.entry((*program, service.clone(), *date, role.clone())).or_default();
                slot.filler = filler.clone();
                slot.approval = (kind == RoleKind::Pulpit { pastor_approves: true } && filler.is_some())
                    .then_some(PastorApproval::Proposed);
                slot.from_outside_district = *from_outside_district && filler.is_some();
                slot.pastor_notified = None;
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
                if self.role_kind(*program, service, *date, role)? == RoleKind::Normal {
                    return Err(RosterError::NotPulpit { program: *program, role: role.clone() });
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
            RosterEvent::NotifyPastor { program, service, date, role, on } => {
                self.role_kind(*program, service, *date, role)?;
                let slot = self.slots.entry((*program, service.clone(), *date, role.clone())).or_default();
                slot.pastor_notified = Some(*on);
                touched.push(Touched::Slot(*program, service.clone(), *date, role.clone()));
            }
            RosterEvent::SetSongs { program, service, date, songs } => {
                self.service_roles(*program, service)?;
                let songs: Vec<String> =
                    songs.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).map(str::to_owned).collect();
                let key = (*program, service.clone(), *date);
                match songs.is_empty() {
                    true => self.songs.remove(&key),
                    false => self.songs.insert(key, songs),
                };
                touched.push(Touched::Songs(*program, service.clone(), *date));
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

    /// Who holds the turn, in the order assigned; empty when nobody does.
    pub fn turn(&self, program: ProgramId, period: &Period) -> &[Member] {
        self.turns.get(&(program, *period)).map_or(&[], Vec::as_slice)
    }

    /// Who holds the turn `date` falls in.
    pub fn turn_on(&self, program: ProgramId, date: Date) -> &[Member] {
        match self.program(program) {
            Some(found) => self.turn(program, &Period::of(found.split, date)),
            None => &[],
        }
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
                let approves = role.kind == RoleKind::Pulpit { pastor_approves: true };
                let notifies = role.kind == RoleKind::Pulpit { pastor_approves: false };
                Slot {
                    role: role.clone(),
                    extra,
                    filler: state.and_then(|s| s.filler.clone()),
                    approval: state.and_then(|s| s.approval.clone()).filter(|_| approves),
                    from_outside_district: state.is_some_and(|s| s.from_outside_district) && notifies,
                    pastor_notified: state.and_then(|s| s.pastor_notified).filter(|_| notifies),
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
            .filter(|period| self.turn(program, period).is_empty())
            .collect()
    }

    /// Turns with a service in the next `window_days` that someone holds,
    /// but fewer than the program expects: the office's "Para hacer".
    pub fn short_turns(&self, setup: &Setup, program: ProgramId, today: Date, window_days: u16) -> Vec<Period> {
        let expected = self.program(program).map_or(0, |p| usize::from(p.holders));
        self.periods(setup, program, today, today.plus_days(window_days.into()))
            .into_iter()
            .filter(|period| (1..expected).contains(&self.turn(program, period).len()))
            .collect()
    }

    /// Roles that are on and nobody fills, on the services of held turns
    /// in the next `window_days`: the turn holders' "Para hacer".
    pub fn empty_slots(&self, setup: &Setup, program: ProgramId, today: Date, window_days: u16) -> Vec<(ServiceId, Date, Role)> {
        self.window(setup, program, today, window_days)
            .filter(|(_, date, slot)| {
                slot.role.on && slot.filler.is_none() && !self.turn_on(program, *date).is_empty()
            })
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
                slot.role.kind == RoleKind::Pulpit { pastor_approves: true }
                    && slot.filler.is_some()
                    && slot.approval != Some(PastorApproval::Approved)
            })
            .map(|(service, date, slot)| (service, date, slot.role))
            .collect()
    }

    /// Speakers from outside the district filled in the next `window_days`
    /// on a pulpit the pastor does not approve, whom the elder has not told
    /// him about: the turn holder's "Para hacer".
    pub fn pastor_not_notified(
        &self,
        setup: &Setup,
        program: ProgramId,
        today: Date,
        window_days: u16,
    ) -> Vec<(ServiceId, Date, Role)> {
        self.window(setup, program, today, window_days)
            .filter(|(_, _, slot)| slot.filler.is_some() && slot.from_outside_district && slot.pastor_notified.is_none())
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

    /// What is sung on `service` that date, in order. Read whether or not
    /// the service keeps a song list now, so nothing recorded is hidden.
    pub fn songs_on(&self, program: ProgramId, service: &ServiceId, date: Date) -> &[String] {
        self.songs.get(&(program, service.clone(), date)).map_or(&[], Vec::as_slice)
    }

    /// Every event that changed the songs of this service on this date,
    /// oldest first.
    pub fn songs_history(&self, program: ProgramId, service: &ServiceId, date: Date) -> Vec<&Recorded> {
        self.recorded(&Touched::Songs(program, service.clone(), date))
    }

    /// Each role that is on, by service and name, that more than one program assigns,
    /// with those programs in order, such as a "Música especial" both the
    /// elders and Sabbath School list on the divine service. Reported for
    /// the offices to settle, never refused.
    pub fn shared_roles(&self) -> Vec<(ServiceId, String, Vec<ProgramId>)> {
        let mut assigners: BTreeMap<(ServiceId, String), Vec<ProgramId>> = BTreeMap::new();
        for program in &self.programs {
            for listed in &program.services {
                for role in listed.roles.iter().filter(|r| r.on) {
                    let by = assigners.entry((listed.service.clone(), role.name.clone())).or_default();
                    if !by.contains(&program.id) {
                        by.push(program.id);
                    }
                }
            }
        }
        assigners
            .into_iter()
            .filter(|(_, by)| by.len() > 1)
            .map(|((service, role), by)| (service, role, by))
            .collect()
    }

    fn recorded(&self, key: &Touched) -> Vec<&Recorded> {
        self.touched.get(key).into_iter().flatten().map(|&at| &self.log[at]).collect()
    }

    /// Whether `actor` may record `event` on `today`. The developer may
    /// record anything. A charge serving today in the office that owns the
    /// work, or in a variant of it such as first elder for the elders, may
    /// record anything about it. Each holder of a turn may also fill its
    /// roles, add roles to its dates and write its songs. A charge that
    /// does not serve today may record nothing. This function is the whole
    /// rule.
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
            runs(program) || self.turn_on(*program, *date).contains(&Member::Charge(charge.id))
        };
        match event {
            RosterEvent::AddHelper { office, name: _, email: _ } => in_office(office),
            RosterEvent::EditHelper { helper, name: _, email: _, active: _ } => {
                self.helper(*helper).is_some_and(|h| in_office(&h.office))
            }
            RosterEvent::AddProgram { office, name: _, split: _, holders: _, period: _, services: _ } => {
                in_office(office)
            }
            RosterEvent::EditProgram { program, name: _, split: _, holders: _, period: _, services: _ }
            | RosterEvent::AssignTurn(Turn { program, period: _, members: _ })
            | RosterEvent::SendToPastor { program, year: _, month: _ }
            | RosterEvent::RecordPastorAnswer { program, service: _, date: _, role: _, approved: _, note: _ } => {
                runs(program)
            }
            RosterEvent::FillSlot { program, service: _, date, role: _, filler: _, from_outside_district: _ }
            | RosterEvent::NotifyPastor { program, service: _, date, role: _, on: _ }
            | RosterEvent::AddExtraRole { program, service: _, date, role: _ }
            | RosterEvent::SetSongs { program, service: _, date, songs: _ } => in_turn(program, date),
        }
    }
}

/// Whether `charge` is a charge of `office`, directly or as a variant.
pub(crate) fn holds(setup: &Setup, charge: &Charge, office: &OfficeId) -> bool {
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
        RosterEvent::AddProgram { office: o, name: _, split: _, holders: _, period: _, services } => {
            office(o)?;
            services.iter().try_for_each(|s| service(&s.service))
        }
        RosterEvent::EditProgram { program: _, name: _, split: _, holders: _, period: _, services } => {
            services.iter().try_for_each(|s| service(&s.service))
        }
        RosterEvent::AssignTurn(Turn { program: _, period: _, members }) => {
            members.iter().try_for_each(|member| match member {
                Member::Charge(id) => charge(*id),
                Member::Helper(_) => Ok(()),
            })
        }
        RosterEvent::FillSlot {
            program: _,
            service: _,
            date: _,
            role: _,
            filler: Some(Filler::Member(Member::Charge(id))),
            from_outside_district: _,
        } => charge(*id),
        RosterEvent::EditHelper { helper: _, name: _, email: _, active: _ }
        | RosterEvent::FillSlot { program: _, service: _, date: _, role: _, filler: _, from_outside_district: _ }
        | RosterEvent::NotifyPastor { program: _, service: _, date: _, role: _, on: _ }
        | RosterEvent::AddExtraRole { program: _, service: _, date: _, role: _ }
        | RosterEvent::SetSongs { program: _, service: _, date: _, songs: _ }
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
    /// The pastor answers only for a pulpit role.
    NotPulpit { program: ProgramId, role: String },
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
            Self::NotPulpit { program, role } => {
                write!(f, "role {role} of program {} is not a pulpit, so the pastor does not answer for it", program.0)
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
    const DANIEL: ChargeId = ChargeId(6);
    const RUT: ChargeId = ChargeId(7);
    const ELDERS: ProgramId = ProgramId(1);
    const YOUTH: ProgramId = ProgramId(2);
    /// The next program a test adds.
    const NEXT: ProgramId = ProgramId(3);
    const SABBATH_SCHOOL: &str = "escuela-sabatica";
    const SABBATH: &str = "culto-divino";
    const SUNDAY: &str = "culto-de-la-noche";
    const WEDNESDAY: &str = "culto-de-oracion";
    const YOUTH_SOCIETY: &str = "jovenes";
    const PREACHER: &str = "Predicador";
    const REFLECTION: &str = "Reflexión";
    const LOCAL: RoleKind = RoleKind::Pulpit { pastor_approves: false };
    const APPROVED: RoleKind = RoleKind::Pulpit { pastor_approves: true };
    const TODAY: Date = Date { year: 2026, month: Month(11), day: 27 };

    fn day(year: u16, month: u8, day: u8) -> Date {
        Date { year, month: Month(month), day }
    }

    fn service(id: &str) -> ServiceId {
        ServiceId::from(id)
    }

    /// An elder, the first elder, the treasurer, the youth director, the
    /// head deacon, the music coordinator and the Sabbath School director,
    /// with Sabbath School, the elders' three services and the youth society.
    fn setup() -> Setup {
        let held = |office: &str, name: &str| NewCharge {
            office: OfficeId::from(office),
            holder: Holder { name: name.into(), email: None },
            term: Term::one_year(2026),
        };
        let places = r#"[{"id":"templo","name":"Templo","kind":"own"}]"#;
        let services = r#"[{"id":"escuela-sabatica","name":"Escuela Sabática","kind":"sabbath_school","weekday":"saturday","time":"09:00","place":"templo"},
                           {"id":"culto-divino","name":"Culto divino","kind":"divine_service","weekday":"saturday","time":"11:00","place":"templo"},
                           {"id":"culto-de-la-noche","name":"Culto de la noche","kind":"sunday_night","weekday":"sunday","time":"19:00","place":"templo"},
                           {"id":"culto-de-oracion","name":"Culto de oración","kind":"prayer_meeting","weekday":"wednesday","time":"19:00","place":"templo"},
                           {"id":"jovenes","name":"Sociedad de Jóvenes","kind":"youth_society","weekday":"saturday","time":"15:30","place":"templo"}]"#;
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
                held("musica", "Daniel"),
                held("escuela-sabatica", "Rut"),
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
        /// With the elders' program from its template, and the youth
        /// society by Sabbath.
        fn new() -> Self {
            let mut church = Self { setup: setup(), roster: Roster::default(), events: Vec::new() };
            let elders = template("anciano").add_program(church.setup.services());
            church.by(PEDRO, elders);
            let youth = listed(YOUTH_SOCIETY, &[("Bienvenida", RoleKind::Normal), ("Himno especial", RoleKind::Normal)]);
            church.by(MARTA, add_program("ministerio-joven", "Sociedad de Jóvenes", Split::ByDate, vec![youth]));
            church
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

        /// The first elder edits the elders' roles so the pastor approves
        /// whoever fills `role` on `on`.
        fn pastor_approves(&mut self, on: &str, role: &str) {
            let mut elders = self.roster.program(ELDERS).unwrap().clone();
            let listed = elders.services.iter_mut().find(|s| s.service == service(on)).unwrap();
            listed.roles.iter_mut().find(|r| r.name == role).unwrap().kind = APPROVED;
            self.by(PEDRO, edit(elders));
        }

        fn not_notified(&self) -> Vec<(ServiceId, Date, String)> {
            let pending = self.roster.pastor_not_notified(&self.setup, ELDERS, TODAY, 14);
            pending.into_iter().map(|(on, date, role)| (on, date, role.name)).collect()
        }
    }

    fn roles(roles: &[(&str, RoleKind)]) -> Vec<Role> {
        roles.iter().map(|&(name, kind)| role(name, kind)).collect()
    }

    fn role(name: &str, kind: RoleKind) -> Role {
        Role { name: name.into(), kind, on: true }
    }

    /// The event that makes the program read as `program`.
    fn edit(program: Program) -> RosterEvent {
        let Program { id, office: _, name, split, holders, period, services } = program;
        RosterEvent::EditProgram { program: id, name, split, holders, period, services }
    }

    fn listed(on: &str, with: &[(&str, RoleKind)]) -> ProgramService {
        ProgramService { service: service(on), roles: roles(with), songs: false }
    }

    fn template(office: &str) -> ProgramTemplate {
        templates().into_iter().find(|t| t.office == OfficeId::from(office)).unwrap()
    }

    fn set_songs(program: ProgramId, on: &str, date: Date, songs: &[&str]) -> RosterEvent {
        RosterEvent::SetSongs { program, service: service(on), date, songs: songs.iter().map(|&s| s.into()).collect() }
    }

    /// The program's services as (service, role names, keeps songs).
    fn shape(program: &Program) -> Vec<(&str, Vec<&str>, bool)> {
        program
            .services
            .iter()
            .map(|s| (s.service.0.as_str(), s.roles.iter().map(|r| r.name.as_str()).collect(), s.songs))
            .collect()
    }

    fn add_program(office: &str, name: &str, split: Split, services: Vec<ProgramService>) -> RosterEvent {
        RosterEvent::AddProgram { office: office.into(), name: name.into(), split, holders: 1, period: SheetPeriod::Month, services }
    }

    fn assign(program: ProgramId, period: Period, member: Member) -> RosterEvent {
        RosterEvent::AssignTurn(Turn { program, period, members: vec![member] })
    }

    fn month(year: u16, month: u8) -> Period {
        Period::Month { year, month: Month(month) }
    }

    fn fill(program: ProgramId, on: &str, date: Date, role: &str, filler: Filler) -> RosterEvent {
        RosterEvent::FillSlot {
            program,
            service: service(on),
            date,
            role: role.into(),
            filler: Some(filler),
            from_outside_district: false,
        }
    }

    /// An elders' pulpit filled by `name`, who comes from outside the district.
    fn from_outside(on: &str, date: Date, role: &str, name: &str) -> RosterEvent {
        RosterEvent::FillSlot {
            program: ELDERS,
            service: service(on),
            date,
            role: role.into(),
            filler: Some(guest(name)),
            from_outside_district: true,
        }
    }

    fn notify(on: &str, date: Date, role: &str) -> RosterEvent {
        RosterEvent::NotifyPastor { program: ELDERS, service: service(on), date, role: role.into(), on: TODAY }
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
        let services = vec![listed(SABBATH, &[(PREACHER, LOCAL)]), listed(WEDNESDAY, &[(REFLECTION, LOCAL)])];
        church.by(PEDRO, add_program("anciano", "Predicación", Split::ByDate, services));
        let december = church.roster.periods(&church.setup, ProgramId(3), day(2026, 12, 1), day(2026, 12, 31));
        assert_eq!(december, [2, 5, 9, 12, 16, 19, 23, 26, 30].map(|d| Period::Date(day(2026, 12, d))));
    }

    #[test]
    fn one_months_turn_covers_every_service_of_the_program() {
        let mut church = Church::new();
        church.by(PEDRO, assign(ELDERS, month(2026, 12), Member::Charge(LUIS)));
        for (on, date, role) in
            [(WEDNESDAY, day(2026, 12, 2), REFLECTION), (SABBATH, day(2026, 12, 5), PREACHER), (SUNDAY, day(2026, 12, 6), REFLECTION)]
        {
            assert!(church.may(LUIS, &fill(ELDERS, on, date, role, guest("Ana"))), "Luis holds {on} on {date}");
            assert!(church.may(LUIS, &notify(on, date, role)), "Luis tells the pastor about {on} on {date}");
        }
        assert!(!church.may(MARTA, &notify(SABBATH, day(2026, 12, 5), PREACHER)), "the youth director holds no elders' turn");
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
        assert_eq!(church.role_names(ELDERS, SUNDAY, day(2026, 12, 6)), [REFLECTION]);
        assert_eq!(church.role_names(ELDERS, WEDNESDAY, day(2026, 12, 2)), [REFLECTION]);
        let mut elders = church.roster.program(ELDERS).unwrap().clone();
        let wednesday = elders.services.iter_mut().find(|s| s.service == service(WEDNESDAY)).unwrap();
        wednesday.roles = roles(&[(REFLECTION, RoleKind::Normal), ("Himno", RoleKind::Normal)]);
        church.by(ELENA, edit(elders));
        assert_eq!(church.role_names(ELDERS, WEDNESDAY, day(2026, 12, 2)), [REFLECTION, "Himno"]);
        assert_eq!(church.slot(ELDERS, WEDNESDAY, day(2026, 12, 2), REFLECTION).unwrap().role.kind, RoleKind::Normal);
        assert_eq!(church.role_names(ELDERS, SABBATH, day(2026, 12, 5)), sabbath);
        assert_eq!(church.role_names(ELDERS, SUNDAY, day(2026, 12, 6)), [REFLECTION]);
    }

    #[test]
    fn the_elders_template_follows_the_manuals_order_of_worship_and_no_pulpit_needs_the_pastor() {
        let mut church = Church::new();
        let sabbath = [
            (PREACHER, LOCAL),
            ("Anuncios", RoleKind::Normal),
            ("Invocación", RoleKind::Normal),
            ("Lectura bíblica", RoleKind::Normal),
            ("Oración", RoleKind::Normal),
            ("Diezmos y ofrendas", RoleKind::Normal),
            ("Música especial", RoleKind::Normal),
        ];
        let elders = church.roster.program(ELDERS).unwrap();
        assert_eq!((elders.office.0.as_str(), elders.split), ("anciano", Split::ByMonth));
        assert_eq!(
            elders.services,
            [
                ProgramService { service: service(SABBATH), roles: roles(&sabbath), songs: false },
                listed(SUNDAY, &[(REFLECTION, LOCAL)]),
                listed(WEDNESDAY, &[(REFLECTION, LOCAL)]),
            ],
            "the Sabbath School and the youth society are not the elders'"
        );

        for (on, date, role) in
            [(WEDNESDAY, day(2026, 12, 2), REFLECTION), (SABBATH, day(2026, 12, 5), PREACHER), (SUNDAY, day(2026, 12, 6), REFLECTION)]
        {
            church.by(ELENA, fill(ELDERS, on, date, role, guest("Hna. Pérez")));
            assert_eq!(church.approval(ELDERS, on, date, role), None, "{on}");
        }
        assert_eq!(church.roster.without_approval(&church.setup, ELDERS, TODAY, 14), []);
    }

    #[test]
    fn an_outside_speaker_without_notice_is_pending_on_every_service_until_the_pastor_is_told() {
        let mut church = Church::new();
        let filled = [(WEDNESDAY, day(2026, 12, 2), REFLECTION), (SABBATH, day(2026, 12, 5), PREACHER), (SUNDAY, day(2026, 12, 6), REFLECTION)];
        for (on, date, role) in filled {
            church.by(ELENA, from_outside(on, date, role, "Pr. Gómez"));
        }
        let pending = filled.map(|(on, date, role)| (service(on), date, role.to_owned()));
        assert_eq!(church.not_notified(), pending);
        church.by(ELENA, notify(SUNDAY, day(2026, 12, 6), REFLECTION));
        assert_eq!(church.not_notified(), pending[..2]);
        assert_eq!(church.slot(ELDERS, SUNDAY, day(2026, 12, 6), REFLECTION).unwrap().pastor_notified, Some(TODAY));
    }

    #[test]
    fn refilling_a_notified_pulpit_makes_it_pending_again() {
        let mut church = Church::new();
        let dec6 = day(2026, 12, 6);
        church.by(ELENA, from_outside(SUNDAY, dec6, REFLECTION, "Pr. Gómez"));
        church.by(ELENA, notify(SUNDAY, dec6, REFLECTION));
        assert_eq!(church.not_notified(), []);
        church.by(ELENA, from_outside(SUNDAY, dec6, REFLECTION, "Pr. Ruiz"));
        assert_eq!(church.not_notified(), [(service(SUNDAY), dec6, REFLECTION.to_owned())]);
        assert_eq!(church.slot(ELDERS, SUNDAY, dec6, REFLECTION).unwrap().pastor_notified, None);
    }

    #[test]
    fn a_local_speaker_is_never_pending() {
        let mut church = Church::new();
        church.by(ELENA, from_outside(WEDNESDAY, day(2026, 12, 2), REFLECTION, "Pr. Gómez"));
        church.by(ELENA, fill(ELDERS, WEDNESDAY, day(2026, 12, 2), REFLECTION, Filler::Member(Member::Charge(ELENA))));
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Hno. Díaz")));
        assert_eq!(church.not_notified(), []);
        assert!(!church.slot(ELDERS, WEDNESDAY, day(2026, 12, 2), REFLECTION).unwrap().from_outside_district);
    }

    #[test]
    fn emptying_an_outside_speakers_pulpit_leaves_nothing_pending() {
        let mut church = Church::new();
        church.by(ELENA, from_outside(SUNDAY, day(2026, 12, 6), REFLECTION, "Pr. Gómez"));
        let empty = RosterEvent::FillSlot {
            program: ELDERS,
            service: service(SUNDAY),
            date: day(2026, 12, 6),
            role: REFLECTION.into(),
            filler: None,
            from_outside_district: true,
        };
        church.by(ELENA, empty);
        assert_eq!(church.not_notified(), []);
    }

    #[test]
    fn an_elder_turns_the_pastors_approval_on_for_wednesday_by_editing_the_roles() {
        let mut church = Church::new();
        church.pastor_approves(WEDNESDAY, REFLECTION);
        church.by(ELENA, from_outside(WEDNESDAY, day(2026, 12, 2), REFLECTION, "Pr. Gómez"));
        assert_eq!(church.approval(ELDERS, WEDNESDAY, day(2026, 12, 2), REFLECTION), Some(PastorApproval::Proposed));
        let pending = church.roster.without_approval(&church.setup, ELDERS, TODAY, 14);
        assert_eq!(pending, [(service(WEDNESDAY), day(2026, 12, 2), role(REFLECTION, APPROVED))]);
        assert_eq!(church.not_notified(), [], "the pastor's approval covers the outside speaker");
    }

    #[test]
    fn a_notice_about_a_preacher_the_pastor_approves_is_accepted_and_kept_in_the_history() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
        let dec5 = day(2026, 12, 5);
        church.by(ELENA, from_outside(SABBATH, dec5, PREACHER, "Pr. Gómez"));
        assert_eq!(church.record(Actor::Charge(ELENA), notify(SABBATH, dec5, PREACHER)), Ok(()));
        let history: Vec<&RosterEvent> = church.roster.history(ELDERS, &service(SABBATH), dec5, PREACHER).into_iter().map(|r| &r.event).collect();
        assert_eq!(history, [&from_outside(SABBATH, dec5, PREACHER, "Pr. Gómez"), &notify(SABBATH, dec5, PREACHER)]);
        assert_eq!(church.approval(ELDERS, SABBATH, dec5, PREACHER), Some(PastorApproval::Proposed));
    }

    #[test]
    fn a_fill_stored_before_the_district_rule_reads_as_a_local_speaker() {
        let stored = r#"{"kind":"fill_slot","program":1,"service":"culto-de-la-noche","date":"2026-12-06","role":"Reflexión","filler":{"name":"Pr. Gómez"}}"#;
        let event: RosterEvent = serde_json::from_str(stored).unwrap();
        assert_eq!(event, fill(ELDERS, SUNDAY, day(2026, 12, 6), REFLECTION, guest("Pr. Gómez")));
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
    fn filling_a_preacher_the_pastor_approves_proposes_it() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Proposed));
    }

    #[test]
    fn sending_the_month_moves_only_that_months_proposed_slots_on_every_service() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
        church.pastor_approves(WEDNESDAY, REFLECTION);
        for date in [day(2026, 12, 5), day(2026, 12, 12), day(2027, 1, 2)] {
            church.by(ELENA, fill(ELDERS, SABBATH, date, PREACHER, guest("Pr. Gómez")));
        }
        church.by(ELENA, fill(ELDERS, WEDNESDAY, day(2026, 12, 9), REFLECTION, guest("Hna. Pérez")));
        church.by(ELENA, fill(ELDERS, SUNDAY, day(2026, 12, 6), REFLECTION, guest("Hna. Pérez")));
        church.by(ELENA, answer(day(2026, 12, 12), true, None));
        church.by(PEDRO, send(2026, 12));
        let states = [day(2026, 12, 5), day(2026, 12, 12), day(2027, 1, 2)].map(|d| church.approval(ELDERS, SABBATH, d, PREACHER));
        assert_eq!(
            states,
            [Some(PastorApproval::WithPastor), Some(PastorApproval::Approved), Some(PastorApproval::Proposed)]
        );
        assert_eq!(church.approval(ELDERS, WEDNESDAY, day(2026, 12, 9), REFLECTION), Some(PastorApproval::WithPastor));
        assert_eq!(church.approval(ELDERS, SUNDAY, day(2026, 12, 6), REFLECTION), None, "Sunday needs no approval");
    }

    #[test]
    fn a_not_approved_answer_empties_the_slot_and_keeps_the_note() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
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
        church.pastor_approves(SABBATH, PREACHER);
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        assert_eq!(church.record(Actor::Charge(ELENA), answer(day(2026, 12, 5), true, None)), Ok(()));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Approved));
    }

    #[test]
    fn filling_a_preacher_while_with_the_pastor_is_accepted_and_proposes_again() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, send(2026, 12));
        let refill = fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Ruiz"));
        assert_eq!(church.record(Actor::Charge(ELENA), refill), Ok(()));
        assert_eq!(church.approval(ELDERS, SABBATH, day(2026, 12, 5), PREACHER), Some(PastorApproval::Proposed));
    }

    #[test]
    fn a_filled_preacher_reads_as_without_approval_until_the_pastor_approves() {
        let mut church = Church::new();
        church.pastor_approves(SABBATH, PREACHER);
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        let pending = |church: &Church| church.roster.without_approval(&church.setup, ELDERS, TODAY, 14);
        let preacher = role(PREACHER, APPROVED);
        assert_eq!(pending(&church), [(service(SABBATH), day(2026, 12, 5), preacher)]);
        church.by(ELENA, answer(day(2026, 12, 5), true, None));
        assert_eq!(pending(&church), []);
    }

    #[test]
    fn an_extra_role_exists_only_on_its_date() {
        let mut church = Church::new();
        let duet = role("Dúo", RoleKind::Normal);
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
        let duet = role("Dúo", RoleKind::Normal);
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
        let elders = Program { services: twice, ..church.roster.program(ELDERS).unwrap().clone() };
        assert_eq!(church.record(Actor::Charge(PEDRO), edit(elders)), Err(RosterError::RepeatedService(service(SABBATH))));
        assert_eq!(church.roster, Roster::replay(&church.events).unwrap(), "a refused event leaves no trace");
    }

    #[test]
    fn replay_of_the_same_events_gives_the_same_roster() {
        let mut church = Church::new();
        let rosa = Some(" Rosa@Example.org".into());
        church.by(MARTA, RosterEvent::AddHelper { office: "ministerio-joven".into(), name: " Rosa ".into(), email: rosa });
        church.by(ELENA, assign(ELDERS, month(2026, 12), Member::Charge(ELENA)));
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 5), PREACHER, guest("Pr. Gómez")));
        church.pastor_approves(SABBATH, PREACHER);
        church.by(ELENA, from_outside(WEDNESDAY, day(2026, 12, 2), REFLECTION, "Hna. Pérez"));
        church.by(ELENA, notify(WEDNESDAY, day(2026, 12, 2), REFLECTION));
        church.by(ELENA, send(2026, 12));
        church.by(ELENA, answer(day(2026, 12, 5), false, Some("Otra fecha")));
        church.by(MARTA, assign(YOUTH, Period::Date(day(2026, 12, 12)), Member::Helper(HelperId(1))));
        let duet = role("Dúo", RoleKind::Normal);
        church.by(MARTA, RosterEvent::AddExtraRole { program: YOUTH, service: service(YOUTH_SOCIETY), date: day(2026, 12, 12), role: duet });
        church.by(MARTA, assign_all(YOUTH, Period::Date(day(2026, 12, 12)), &[]));
        assert_eq!(Roster::replay(&church.events).unwrap(), church.roster);
    }

    #[test]
    fn history_lists_previous_fillers_with_who_changed_them() {
        let mut church = Church::new();
        let dec5 = day(2026, 12, 5);
        church.by(ELENA, fill(ELDERS, SABBATH, dec5, PREACHER, guest("Pr. Gómez")));
        church.by(ELENA, fill(ELDERS, SABBATH, day(2026, 12, 12), PREACHER, guest("Pr. Ruiz")));
        church.by(ELENA, fill(ELDERS, SUNDAY, day(2026, 12, 6), REFLECTION, guest("Pr. Ruiz")));
        church.by(PEDRO, fill(ELDERS, SABBATH, dec5, PREACHER, Filler::Member(Member::Charge(ELENA))));
        church.by(ELENA, notify(SABBATH, dec5, PREACHER));
        church.by(PEDRO, send(2026, 12));
        let history: Vec<(Actor, &RosterEvent)> =
            church.roster.history(ELDERS, &service(SABBATH), dec5, PREACHER).into_iter().map(|r| (r.by, &r.event)).collect();
        assert_eq!(
            history,
            [
                (Actor::Charge(ELENA), &fill(ELDERS, SABBATH, dec5, PREACHER, guest("Pr. Gómez"))),
                (Actor::Charge(PEDRO), &fill(ELDERS, SABBATH, dec5, PREACHER, Filler::Member(Member::Charge(ELENA)))),
                (Actor::Charge(ELENA), &notify(SABBATH, dec5, PREACHER)),
            ]
        );
    }

    #[test]
    fn editing_a_programs_split_changes_its_periods() {
        let mut church = Church::new();
        let december = |church: &Church| church.roster.periods(&church.setup, ELDERS, day(2026, 12, 1), day(2026, 12, 13));
        assert_eq!(december(&church), [month(2026, 12)]);
        let elders = Program { split: Split::ByDate, ..church.roster.program(ELDERS).unwrap().clone() };
        church.by(PEDRO, edit(elders));
        assert_eq!(december(&church), [2, 5, 6, 9, 12, 13].map(|d| Period::Date(day(2026, 12, d))));
    }

    #[test]
    fn the_singing_template_gives_four_services_singers_and_a_song_list_only_on_sabbath_school() {
        let mut church = Church::new();
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        let singing = church.roster.program(NEXT).unwrap();
        assert_eq!((singing.name.as_str(), singing.office.0.as_str()), ("Servicio de canto", "musica"));
        let (three, two) = (vec!["Cantante 1", "Cantante 2", "Cantante 3"], vec!["Cantante 1", "Cantante 2"]);
        assert_eq!(
            shape(singing),
            [
                (SABBATH_SCHOOL, three, true),
                (SABBATH, two.clone(), false),
                (SUNDAY, two.clone(), false),
                (WEDNESDAY, two, false),
            ],
            "the youth society is not the singers'"
        );
    }

    #[test]
    fn a_service_kind_the_church_does_not_hold_is_left_out_of_the_template() {
        let church = Church::new();
        let without_sunday: Vec<Service> =
            church.setup.services().iter().filter(|s| s.id != service(SUNDAY)).cloned().collect();
        let RosterEvent::AddProgram { services, .. } = template("musica").add_program(&without_sunday) else {
            panic!("a template adds a program");
        };
        let held: Vec<&str> = services.iter().map(|s| s.service.0.as_str()).collect();
        assert_eq!(held, [SABBATH_SCHOOL, SABBATH, WEDNESDAY]);
    }

    #[test]
    fn changing_how_many_sing_is_an_edit_of_the_services_roles() {
        let mut church = Church::new();
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        let mut singing = church.roster.program(NEXT).unwrap().clone();
        singing.services.iter_mut().find(|s| s.service == service(SABBATH)).unwrap().roles = singers(5);
        church.by(DANIEL, edit(singing));
        let five: Vec<String> = (1..=5).map(|i| format!("Cantante {i}")).collect();
        assert_eq!(church.role_names(NEXT, SABBATH, day(2026, 12, 5)), five);
        assert_eq!(church.role_names(NEXT, SUNDAY, day(2026, 12, 6)).len(), 2, "other services keep their two");
        assert_eq!(church.record(Actor::Charge(DANIEL), fill(NEXT, SABBATH, day(2026, 12, 5), "Cantante 5", guest("Ana"))), Ok(()));
    }

    #[test]
    fn songs_set_for_a_date_read_back_and_an_empty_list_clears_them() {
        let mut church = Church::new();
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        let dec5 = day(2026, 12, 5);
        let hymns = set_songs(NEXT, SABBATH_SCHOOL, dec5, &["Himno 100", " Cuán grande es Él "]);
        church.by(DANIEL, hymns.clone());
        let read = |church: &Church| church.roster.songs_on(NEXT, &service(SABBATH_SCHOOL), dec5).to_vec();
        assert_eq!(read(&church), ["Himno 100", "Cuán grande es Él"]);
        assert_eq!(church.roster.songs_on(NEXT, &service(SABBATH_SCHOOL), day(2026, 12, 12)), [] as [String; 0]);
        church.by(DANIEL, set_songs(NEXT, SABBATH_SCHOOL, dec5, &[]));
        assert_eq!(read(&church), [] as [String; 0]);
        let history: Vec<&RosterEvent> =
            church.roster.songs_history(NEXT, &service(SABBATH_SCHOOL), dec5).into_iter().map(|r| &r.event).collect();
        assert_eq!(history, [&hymns, &set_songs(NEXT, SABBATH_SCHOOL, dec5, &[])]);
        assert_eq!(Roster::replay(&church.events).unwrap(), church.roster);
    }

    #[test]
    fn the_office_and_the_turns_holder_write_the_songs_and_nobody_else() {
        let mut church = Church::new();
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        church.by(DANIEL, assign(NEXT, month(2026, 12), Member::Charge(JUAN)));
        let december = set_songs(NEXT, SABBATH_SCHOOL, day(2026, 12, 5), &["Himno 100"]);
        let january = set_songs(NEXT, SABBATH_SCHOOL, day(2027, 1, 2), &["Himno 100"]);
        assert!(church.may(DANIEL, &january), "the music coordinator runs the program");
        assert!(church.may(JUAN, &december), "Juan holds December");
        assert!(!church.may(JUAN, &january), "January is not his");
        assert!(!church.may(LUIS, &december), "the treasurer holds no turn");
    }

    #[test]
    fn songs_on_a_service_without_a_song_list_are_accepted() {
        let mut church = Church::new();
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        let dec5 = day(2026, 12, 5);
        assert!(!church.roster.program(NEXT).unwrap().services.iter().any(|s| s.service == service(SABBATH) && s.songs));
        assert_eq!(church.record(Actor::Charge(DANIEL), set_songs(NEXT, SABBATH, dec5, &["Himno 50"])), Ok(()));
        assert_eq!(church.roster.songs_on(NEXT, &service(SABBATH), dec5), ["Himno 50"]);
        let refused = church.record(Actor::Charge(DANIEL), set_songs(NEXT, YOUTH_SOCIETY, dec5, &["Himno 50"]));
        assert_eq!(refused, Err(RosterError::ServiceNotInProgram { program: NEXT, service: service(YOUTH_SOCIETY) }));
    }

    #[test]
    fn a_role_two_programs_assign_on_one_service_shows_as_shared() {
        let mut church = Church::new();
        assert_eq!(church.roster.shared_roles(), []);
        let special = [("Música especial", RoleKind::Normal)];
        let sabbath_school = vec![listed(SABBATH_SCHOOL, &special), listed(SABBATH, &special)];
        church.by(RUT, add_program("escuela-sabatica", "Escuela Sabática", Split::ByDate, sabbath_school));
        church.by(DANIEL, template("musica").add_program(church.setup.services()));
        assert_eq!(church.roster.shared_roles(), [(service(SABBATH), "Música especial".to_owned(), vec![ELDERS, NEXT])]);
    }

    #[test]
    fn a_program_service_stored_before_song_lists_keeps_none() {
        let stored = r#"{"service":"culto-divino","roles":[{"name":"Predicador","kind":"normal"}]}"#;
        let listed: ProgramService = serde_json::from_str(stored).unwrap();
        assert!(!listed.songs);
    }

    impl Church {
        /// With Sabbath School from its template, as program `NEXT`.
        fn with_sabbath_school() -> Self {
            let mut church = Self::new();
            church.by(RUT, template("escuela-sabatica").add_program(church.setup.services()));
            church
        }

        fn open_roles(&self, program: ProgramId, date: Date) -> Vec<String> {
            let open = self.roster.empty_slots(&self.setup, program, TODAY, 21);
            open.into_iter().filter(|(_, d, _)| *d == date).map(|(_, _, role)| role.name).collect()
        }
    }

    fn assign_all(program: ProgramId, period: Period, members: &[ChargeId]) -> RosterEvent {
        RosterEvent::AssignTurn(Turn { program, period, members: members.iter().map(|&c| Member::Charge(c)).collect() })
    }

    fn sabbath(d: u8) -> Period {
        Period::Date(day(2026, 12, d))
    }

    #[test]
    fn a_turn_stored_with_one_member_reads_as_one_holder_and_null_as_nobody() {
        let one = r#"{"kind":"assign_turn","program":2,"period":{"date":"2026-12-05"},"member":{"charge":5}}"#;
        assert_eq!(serde_json::from_str::<RosterEvent>(one).unwrap(), assign(YOUTH, sabbath(5), Member::Charge(JUAN)));
        let nobody = r#"{"kind":"assign_turn","program":2,"period":{"date":"2026-12-05"},"member":null}"#;
        assert_eq!(serde_json::from_str::<RosterEvent>(nobody).unwrap(), assign_all(YOUTH, sabbath(5), &[]));
        let two = assign_all(YOUTH, sabbath(5), &[JUAN, LUIS]);
        let written = serde_json::to_string(&two).unwrap();
        assert!(written.contains(r#""members":[{"charge":5},{"charge":3}]"#), "{written}");
        assert_eq!(serde_json::from_str::<RosterEvent>(&written).unwrap(), two);
    }

    #[test]
    fn both_holders_of_a_sabbath_may_fill_its_roles_and_an_outsider_may_not() {
        let mut church = Church::with_sabbath_school();
        church.by(RUT, assign_all(NEXT, sabbath(5), &[JUAN, LUIS]));
        let misionero = |d: u8| fill(NEXT, SABBATH_SCHOOL, day(2026, 12, d), "Misionero", guest("Ana"));
        assert!(church.may(JUAN, &misionero(5)), "Juan is a cargo on Dec 5");
        assert!(church.may(LUIS, &misionero(5)), "Luis is a cargo on Dec 5");
        assert!(!church.may(MARTA, &misionero(5)), "the youth director is not a cargo");
        assert!(!church.may(JUAN, &misionero(12)), "Dec 12 is not his");
        assert!(church.may(RUT, &misionero(12)), "the director fills any Sabbath");
        assert_eq!(church.roster.turn_on(NEXT, day(2026, 12, 5)), [Member::Charge(JUAN), Member::Charge(LUIS)]);
    }

    #[test]
    fn a_turn_short_of_holders_is_short_and_one_with_none_is_unassigned() {
        let mut church = Church::with_sabbath_school();
        church.by(RUT, assign_all(NEXT, Period::Date(day(2026, 11, 28)), &[JUAN]));
        church.by(RUT, assign_all(NEXT, sabbath(5), &[JUAN, LUIS, MARTA]));
        church.by(RUT, assign_all(NEXT, sabbath(19), &[JUAN, LUIS]));
        assert_eq!(church.roster.short_turns(&church.setup, NEXT, TODAY, 30), [Period::Date(day(2026, 11, 28))]);
        assert_eq!(church.roster.unassigned(&church.setup, NEXT, TODAY, 30), [sabbath(12), sabbath(26)]);
        church.by(RUT, assign_all(NEXT, sabbath(5), &[]));
        assert_eq!(church.roster.unassigned(&church.setup, NEXT, TODAY, 30), [sabbath(5), sabbath(12), sabbath(26)]);
    }

    #[test]
    fn an_off_role_asks_nobody_to_fill_it_and_filling_it_is_accepted() {
        let mut church = Church::with_sabbath_school();
        church.by(RUT, assign_all(NEXT, sabbath(5), &[JUAN, LUIS]));
        assert_eq!(church.open_roles(NEXT, day(2026, 12, 5)), ["Misionero", "Nuevo Horizonte"]);
        let prayer = fill(NEXT, SABBATH_SCHOOL, day(2026, 12, 5), "Oración", guest("Ana"));
        assert_eq!(church.record(Actor::Charge(JUAN), prayer), Ok(()));
        let slot = church.slot(NEXT, SABBATH_SCHOOL, day(2026, 12, 5), "Oración").unwrap();
        assert_eq!((slot.role.on, slot.filler), (false, Some(guest("Ana"))));
    }

    #[test]
    fn turning_a_role_on_makes_it_pending() {
        let mut church = Church::with_sabbath_school();
        church.by(RUT, assign_all(NEXT, sabbath(5), &[JUAN, LUIS]));
        let mut sabbath_school = church.roster.program(NEXT).unwrap().clone();
        sabbath_school.services[0].roles.iter_mut().find(|r| r.name == "Himno").unwrap().on = true;
        church.by(RUT, edit(sabbath_school));
        assert_eq!(church.open_roles(NEXT, day(2026, 12, 5)), ["Misionero", "Nuevo Horizonte", "Himno"]);
    }

    #[test]
    fn an_off_role_is_not_shared_with_another_program() {
        let mut church = Church::new();
        let mut special = listed(SABBATH, &[("Música especial", RoleKind::Normal)]);
        special.roles[0].on = false;
        church.by(RUT, add_program("escuela-sabatica", "Escuela Sabática", Split::ByDate, vec![special]));
        assert_eq!(church.roster.shared_roles(), []);
    }

    #[test]
    fn the_sabbath_school_template_has_two_a_cargo_each_sabbath_on_a_quarterly_sheet() {
        let church = Church::with_sabbath_school();
        let sabbath_school = church.roster.program(NEXT).unwrap();
        assert_eq!(
            (sabbath_school.name.as_str(), sabbath_school.office.0.as_str(), sabbath_school.split),
            ("Escuela Sabática", "escuela-sabatica", Split::ByDate)
        );
        assert_eq!((sabbath_school.holders, sabbath_school.period), (2, SheetPeriod::Quarter));
        let roles: Vec<(&str, bool)> =
            sabbath_school.services[0].roles.iter().map(|r| (r.name.as_str(), r.on)).collect();
        assert_eq!(
            roles,
            [
                ("Misionero", true),
                ("Nuevo Horizonte", true),
                ("Oración", false),
                ("Lectura bíblica", false),
                ("Himno", false),
                ("Especial", false),
            ]
        );
        assert_eq!(shape(sabbath_school).len(), 1, "never on the youth society's sheet");
        assert_eq!((sabbath_school.services[0].service.0.as_str(), sabbath_school.services[0].songs), (SABBATH_SCHOOL, false));
        let december = church.roster.periods(&church.setup, NEXT, day(2026, 12, 1), day(2026, 12, 31));
        assert_eq!(december, [5, 12, 19, 26].map(sabbath));
    }

    #[test]
    fn a_sheet_covers_its_calendar_month_or_quarter() {
        let nov14 = day(2026, 11, 14);
        assert_eq!(SheetPeriod::Quarter.range(nov14), (day(2026, 10, 1), day(2026, 12, 31)));
        assert_eq!(SheetPeriod::Quarter.range(day(2028, 3, 31)), (day(2028, 1, 1), day(2028, 3, 31)));
        assert_eq!(SheetPeriod::Quarter.range(day(2026, 4, 1)), (day(2026, 4, 1), day(2026, 6, 30)));
        assert_eq!(SheetPeriod::Month.range(nov14), (day(2026, 11, 1), day(2026, 11, 30)));
    }

    #[test]
    fn the_singing_template_has_no_role_for_whoever_leads_the_singers() {
        let singing = template("musica");
        let names: Vec<&str> = singing.services.iter().flat_map(|s| &s.roles).map(|r| r.name.as_str()).collect();
        assert!(names.iter().all(|name| name.starts_with("Cantante ")), "{names:?}");
        assert_eq!((singing.holders, singing.period), (1, SheetPeriod::Month));
    }

    #[test]
    fn a_program_stored_without_period_holders_or_on_reads_as_a_month_one_holder_and_on() {
        let stored = r#"{"kind":"add_program","office":"anciano","name":"Cultos","split":"by_month","services":[{"service":"culto-divino","roles":[{"name":"Predicador","kind":"normal"}]}]}"#;
        let recorded = Recorded { at: "2026-11-27T05:32:43Z".into(), by: Actor::Charge(PEDRO), event: serde_json::from_str(stored).unwrap() };
        let roster = Roster::replay(&[recorded]).unwrap();
        let program = roster.program(ProgramId(1)).unwrap();
        assert_eq!((program.holders, program.period), (1, SheetPeriod::Month));
        assert_eq!(program.services[0].roles, [role(PREACHER, RoleKind::Normal)]);
    }
}
