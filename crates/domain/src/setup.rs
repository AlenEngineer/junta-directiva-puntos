//! The church's setup as the votes behind it.
//!
//! The setup itself is never stored. Its history is: the initial setup, then
//! one entry per vote. `Setup` replays that history over the bundled manual,
//! so the catalog and the charges are derived, never edited, and a `Setup`
//! exists only once every rule held.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::catalog::{Catalog, CatalogEdit, Layer, OfficeId};
use crate::{Charge, ChargeId, NewCharge};

/// Position in the history, from 1, without gaps. A SQLite row id, far below
/// 2^53, so a JSON number in the browser.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export, type = "number")]
pub struct EntryId(pub i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum VotingBody {
    /// The church's highest authority. It elects the officers (pp. 141-146, 163-164).
    BusinessMeeting,
    /// Acts between business meetings and keeps its own agenda (p. 167).
    Board,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Vote {
    pub body: VotingBody,
    /// `YYYY-MM-DD`, the day the body voted.
    pub date: String,
    /// The minute (acta) that records the vote, when the clerk has its reference.
    pub minute: Option<String>,
}

impl fmt::Display for Vote {
    /// The `approved_by` of an office the vote adds or replaces, in Spanish
    /// like the manual: "Reunión administrativa, 2026-03-07, Acta 3/2026".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let body = match self.body {
            VotingBody::BusinessMeeting => "Reunión administrativa",
            VotingBody::Board => "Junta directiva",
        };
        write!(f, "{body}, {}", self.date)?;
        match self.minute.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            Some(minute) => write!(f, ", {minute}"),
            None => Ok(()),
        }
    }
}

/// What approved an entry. `Initial` is the developer's exception, loaded
/// once from the setup file with no vote, and only ever entry 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Approval {
    Initial,
    Vote(Vote),
}

/// What a vote decides. Every part is optional and an absent part changes
/// nothing. The parts apply in this order, so one vote can create an office
/// and fill it, or release a holder and hide the office: rename, catalog,
/// release, elect.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Change {
    /// A new name for the church.
    #[serde(default)]
    pub church: Option<String>,
    /// Offices added, replaced, hidden or restored, and the board agenda, in
    /// the terms of a layer file. The church's name names the layer.
    #[serde(default)]
    pub catalog: CatalogEdit,
    /// Officers elected. Each gets the next charge id.
    #[serde(default)]
    pub elect: Vec<NewCharge>,
    /// Charges that end.
    #[serde(default)]
    pub release: Vec<ChargeId>,
}

impl Change {
    pub fn is_empty(&self) -> bool {
        let Self { church, catalog, elect, release } = self;
        church.is_none() && catalog.is_empty() && elect.is_empty() && release.is_empty()
    }

    /// Whether the board may vote the change. The board keeps its own agenda,
    /// and the church decides everything else in a business meeting.
    /// Destructured in full so a new kind of change does not reach the board
    /// by default.
    fn is_agenda_only(&self) -> bool {
        let Self { church, catalog: CatalogEdit { offices, hide, restore, board_agenda: _ }, elect, release } = self;
        church.is_none() && offices.is_empty() && hide.is_empty() && restore.is_empty() && elect.is_empty() && release.is_empty()
    }

    /// Checked when a change is recorded and never on replay, so a rule
    /// tightened later cannot make recorded history unreadable.
    fn check(&self) -> Result<(), SetupError> {
        if self.elect.iter().any(|new| new.holder.name.trim().is_empty()) {
            return Err(SetupError::BlankHolder);
        }
        Ok(())
    }
}

/// One step of the history, as stored and as `GET /api/setup/history` lists
/// it. It keeps what was submitted, and replay replaces the derived fields
/// inside it, such as an office's `layer` and `approved_by`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Entry {
    pub id: EntryId,
    pub approval: Approval,
    pub change: Change,
    /// UTC, `YYYY-MM-DDTHH:MM:SSZ`, set by the database when the row is written.
    pub recorded_at: String,
}

/// A vote to record. It carries a `Vote`, not an `Approval`, so nothing sent
/// over HTTP can claim to be the initial setup.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct NewEntry {
    /// The `latest` entry of the setup the vote was decided against. A vote
    /// made against a history that has moved on, or sent twice, is refused.
    pub after: EntryId,
    pub vote: Vote,
    pub change: Change,
}

impl NewEntry {
    fn check(&self) -> Result<(), SetupError> {
        if !crate::is_iso_date(&self.vote.date) {
            return Err(SetupError::BadDate(self.vote.date.clone()));
        }
        if self.change.is_empty() {
            return Err(SetupError::EmptyChange);
        }
        if self.vote.body == VotingBody::Board && !self.change.is_agenda_only() {
            return Err(SetupError::NeedsBusinessMeeting);
        }
        self.change.check()
    }
}

/// The church's setup at some point of its history.
#[derive(Debug, Clone)]
pub struct Setup {
    facts: Facts,
    catalog: Catalog,
    charges: Vec<Charge>,
}

impl Setup {
    /// The setup a church starts from: entry 1, with no vote.
    pub fn initial(change: &Change) -> Result<Self, SetupError> {
        change.check()?;
        Facts::default().then(EntryId(1), None, change)?.build()
    }

    /// The setup once `new` is recorded, or why it cannot be.
    pub fn apply(&self, new: &NewEntry) -> Result<Self, SetupError> {
        if new.after != self.latest() {
            return Err(SetupError::Stale);
        }
        new.check()?;
        self.facts.clone().then(EntryId(new.after.0 + 1), Some(&new.vote), &new.change)?.build()
    }

    /// The setup a stored history adds up to. It trusts what each entry
    /// decided and checks only that the entries form a history whose result
    /// is a valid setup.
    pub fn replay(entries: &[Entry]) -> Result<Self, SetupError> {
        if entries.is_empty() {
            return Err(SetupError::NoSetup);
        }
        entries
            .iter()
            .try_fold(Facts::default(), |facts, entry| {
                let vote = match &entry.approval {
                    Approval::Initial => None,
                    Approval::Vote(vote) => Some(vote),
                };
                facts.then(entry.id, vote, &entry.change)
            })?
            .build()
    }

    pub fn latest(&self) -> EntryId {
        self.facts.latest
    }

    pub fn church(&self) -> &str {
        &self.facts.church
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    pub fn charges(&self) -> &[Charge] {
        &self.charges
    }
}

impl Serialize for Setup {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Served { church: self.church(), latest: self.latest(), catalog: &self.catalog, charges: &self.charges }.serialize(serializer)
    }
}

/// The church's setup as its votes leave it, and `latest`, the entry the
/// next vote names as `after`.
#[derive(Serialize, TS)]
#[ts(export, rename = "Setup")]
struct Served<'a> {
    church: &'a str,
    latest: EntryId,
    catalog: &'a Catalog,
    charges: &'a [Charge],
}

/// What the history says, folded but not yet checked as a whole.
#[derive(Debug, Clone, Default)]
struct Facts {
    latest: EntryId,
    church: String,
    /// The catalog part of every entry that changed the catalog, in order,
    /// with each office a vote added stamped with that vote.
    edits: Vec<CatalogEdit>,
    /// The charges held, under the ids the history gave them.
    elected: Vec<(ChargeId, NewCharge)>,
    /// Charge ids handed out so far. A released id is never handed out again.
    issued: u32,
}

impl Facts {
    fn then(mut self, id: EntryId, vote: Option<&Vote>, change: &Change) -> Result<Self, SetupError> {
        if id.0 != self.latest.0 + 1 {
            return Err(SetupError::Malformed(format!("entry {} follows entry {}", id.0, self.latest.0)));
        }
        match (id.0, vote) {
            (1, Some(_)) => return Err(SetupError::Malformed("entry 1 has a vote, but the initial setup has none".into())),
            (2.., None) => return Err(SetupError::Malformed(format!("entry {} has no vote", id.0))),
            _ => {}
        }
        if let Some(name) = &change.church {
            self.church = name.trim().to_owned();
        }
        if !change.catalog.is_empty() {
            let mut edit = change.catalog.clone();
            if let Some(vote) = vote {
                for office in &mut edit.offices {
                    office.approved_by = Some(vote.to_string());
                }
            }
            self.edits.push(edit);
        }
        for charge in &change.release {
            let Some(at) = self.elected.iter().position(|(id, _)| id == charge) else {
                return Err(SetupError::UnknownCharge(*charge));
            };
            self.elected.remove(at);
        }
        for new in &change.elect {
            self.issued += 1;
            self.elected.push((ChargeId(self.issued), NewCharge { holder: new.holder.normalized(), ..new.clone() }));
        }
        self.latest = id;
        Ok(self)
    }

    fn build(self) -> Result<Setup, SetupError> {
        if self.church.is_empty() {
            return Err(SetupError::NoChurchName);
        }
        let church = self.edits.iter().map(|edit| Layer { name: self.church.clone(), edit: edit.clone() });
        let catalog = Catalog::from_layers(std::iter::once(Layer::manual_2025()).chain(church)).map_err(SetupError::Catalog)?;
        let charges = self
            .elected
            .iter()
            .map(|(id, new)| {
                Charge::from_catalog(&catalog, *id, new)
                    .ok_or_else(|| SetupError::ChargeWithoutOffice { charge: *id, office: new.office.clone() })
            })
            .collect::<Result<_, _>>()?;
        Ok(Setup { facts: self, catalog, charges })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupError {
    /// The catalog would be invalid. Carries the catalog's own message.
    Catalog(String),
    NoChurchName,
    EmptyChange,
    BadDate(String),
    BlankHolder,
    /// The board voted something only a business meeting can decide.
    NeedsBusinessMeeting,
    UnknownCharge(ChargeId),
    /// A charge whose office is not in the catalog, because it was elected
    /// into an unknown office or its office was hidden while it was held.
    ChargeWithoutOffice { charge: ChargeId, office: OfficeId },
    /// `after` is not the latest entry, because the history moved on or
    /// another vote took that place first.
    Stale,
    /// Nothing was ever recorded.
    NoSetup,
    /// Stored entries that do not form a history.
    Malformed(String),
}

impl fmt::Display for SetupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Catalog(message) => f.write_str(message),
            Self::NoChurchName => write!(f, "the church needs a name"),
            Self::EmptyChange => write!(f, "a vote has to change something"),
            Self::BadDate(date) => write!(f, "{date} is not a YYYY-MM-DD date"),
            Self::BlankHolder => write!(f, "a charge needs a holder with a name"),
            Self::NeedsBusinessMeeting => {
                write!(f, "the board can only change the board agenda; this change needs a business meeting vote")
            }
            Self::UnknownCharge(id) => write!(f, "charge {} is not held, so it cannot be released", id.0),
            Self::ChargeWithoutOffice { charge, office } => write!(f, "charge {} is for unknown office {}", charge.0, office.0),
            Self::Stale => write!(f, "the church setup changed; reload and try again"),
            Self::NoSetup => write!(f, "the church has no setup yet; start the server with SETUP_FILE"),
            Self::Malformed(why) => write!(f, "the stored setup history is malformed: {why}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::VotingBody::{Board, BusinessMeeting};
    use super::*;
    use crate::{Holder, Term};

    fn elect(office: &str, name: &str) -> NewCharge {
        NewCharge { office: office.into(), holder: Holder { name: name.into(), email: None }, term: Term::one_year(2026) }
    }

    fn vote(body: VotingBody) -> Vote {
        Vote { body, date: "2026-03-07".into(), minute: Some("Acta 3/2026".into()) }
    }

    fn catalog(json: &str) -> CatalogEdit {
        serde_json::from_str(json).unwrap()
    }

    fn church() -> Setup {
        Setup::initial(&Change { church: Some("Iglesia".into()), elect: vec![elect("tesorero", "Luis Pérez")], ..Change::default() })
            .unwrap()
    }

    fn decide(setup: &Setup, body: VotingBody, change: Change) -> Result<Setup, SetupError> {
        setup.apply(&NewEntry { after: setup.latest(), vote: vote(body), change })
    }

    fn entry(id: i64, approval: Approval, change: Change) -> Entry {
        Entry { id: EntryId(id), approval, change, recorded_at: "2026-11-27T05:32:43Z".into() }
    }

    fn json<T: Serialize + ?Sized>(value: &T) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }

    #[test]
    fn one_vote_adds_an_office_and_elects_its_holder() {
        let office = r#"{"offices":[{"id":"bienvenida","name":"Coordinador de bienvenida","board_member":false,
                         "responsibilities":[{"summary":"Recibir a las visitas"}]}]}"#;
        let holder = Holder { name: " Carlos Díaz ".into(), email: Some(" Carlos@Example.org ".into()) };
        let change = Change { catalog: catalog(office), elect: vec![NewCharge { holder, ..elect("bienvenida", "") }], ..Change::default() };
        let next = decide(&church(), BusinessMeeting, change).unwrap();

        assert_eq!(next.latest(), EntryId(2));
        let office = next.catalog().office(&"bienvenida".into()).expect("the vote added it");
        assert_eq!(office.approved_by.as_deref(), Some("Reunión administrativa, 2026-03-07, Acta 3/2026"));
        assert_eq!(office.layer, "Iglesia");
        let charge = next.charges().last().unwrap();
        assert_eq!((charge.id, charge.office.0.as_str()), (ChargeId(2), "bienvenida"));
        assert_eq!(charge.holder, Holder { name: "Carlos Díaz".into(), email: Some("carlos@example.org".into()) });
        assert_eq!(charge.responsibilities[0].summary, "Recibir a las visitas");
    }

    #[test]
    fn the_board_votes_only_its_agenda() {
        let setup = church();
        let agenda = Change { catalog: catalog(r#"{"board_agenda":[{"id":"oracion","title":"Oración"}]}"#), ..Change::default() };
        for body in [Board, BusinessMeeting] {
            assert_eq!(decide(&setup, body, agenda.clone()).unwrap().catalog().board_agenda.len(), 1);
        }
        let election = Change { elect: vec![elect("secretario", "Ana Rojas")], ..Change::default() };
        for change in [
            election.clone(),
            Change { church: Some("Iglesia Central".into()), ..agenda },
            Change { catalog: catalog(r#"{"hide":["club-de-aventureros"]}"#), ..Change::default() },
            Change { release: vec![ChargeId(1)], ..Change::default() },
        ] {
            assert_eq!(decide(&setup, Board, change).unwrap_err(), SetupError::NeedsBusinessMeeting);
        }
        assert!(decide(&setup, BusinessMeeting, election).is_ok());
    }

    #[test]
    fn a_hidden_office_is_restored_by_a_later_vote() {
        let hide = Change { catalog: catalog(r#"{"hide":["club-de-aventureros"]}"#), ..Change::default() };
        let restore = Change { catalog: catalog(r#"{"restore":["club-de-aventureros"]}"#), ..Change::default() };
        let hidden = decide(&church(), BusinessMeeting, hide).unwrap();
        assert!(hidden.catalog().office(&"club-de-aventureros".into()).is_none());

        let restored = decide(&hidden, BusinessMeeting, restore.clone()).unwrap();
        assert_eq!(restored.catalog().office(&"club-de-aventureros".into()).and_then(|o| o.page), Some(138));
        let err = decide(&restored, BusinessMeeting, restore).unwrap_err();
        assert_eq!(err.to_string(), "Iglesia: cannot restore office club-de-aventureros, which is not hidden");
    }

    #[test]
    fn one_vote_can_release_a_holder_and_hide_the_office() {
        let first = church();
        let hide = Change { catalog: catalog(r#"{"hide":["tesorero"]}"#), ..Change::default() };
        let err = decide(&first, BusinessMeeting, hide.clone()).unwrap_err();
        assert_eq!(err.to_string(), "charge 1 is for unknown office tesorero");

        let next = decide(&first, BusinessMeeting, Change { release: vec![ChargeId(1)], ..hide }).unwrap();
        assert!(next.charges().is_empty() && next.catalog().office(&"tesorero".into()).is_none());
    }

    #[test]
    fn a_change_that_breaks_the_catalog_is_refused_with_the_catalog_message() {
        let setup = church();
        for (edit, message) in [
            (r#"{"hide":["club-de-aventurero"]}"#, "Iglesia: cannot hide unknown office club-de-aventurero"),
            (r#"{"hide":["anciano"]}"#, "primer-anciano is a variant of unknown anciano"),
            (
                r#"{"offices":[{"id":"a","name":"A","board_member":true},{"id":"a","name":"B","board_member":true}]}"#,
                "Iglesia: office a appears twice",
            ),
        ] {
            let err = decide(&setup, BusinessMeeting, Change { catalog: catalog(edit), ..Change::default() }).unwrap_err();
            assert_eq!(err.to_string(), message);
        }
    }

    #[test]
    fn a_vote_counts_only_against_the_history_it_was_decided_on() {
        let rename = Change { church: Some("Iglesia Central".into()), ..Change::default() };
        let next = decide(&church(), BusinessMeeting, rename.clone()).unwrap();
        for after in [EntryId(1), EntryId(3)] {
            let new = NewEntry { after, vote: vote(BusinessMeeting), change: rename.clone() };
            assert_eq!(next.apply(&new).unwrap_err(), SetupError::Stale, "after {after:?}");
        }
    }

    #[test]
    fn a_vote_decides_something_on_a_date_and_names_who_it_elects() {
        let setup = church();
        assert_eq!(decide(&setup, BusinessMeeting, Change::default()).unwrap_err(), SetupError::EmptyChange);
        let undated = NewEntry {
            after: setup.latest(),
            vote: Vote { date: "07/03/2026".into(), ..vote(BusinessMeeting) },
            change: Change { church: Some("Iglesia Central".into()), ..Change::default() },
        };
        assert_eq!(setup.apply(&undated).unwrap_err(), SetupError::BadDate("07/03/2026".into()));
        let nameless = Change { elect: vec![elect("secretario", "  ")], ..Change::default() };
        assert_eq!(decide(&setup, BusinessMeeting, nameless).unwrap_err(), SetupError::BlankHolder);
    }

    #[test]
    fn charge_ids_are_never_reused_and_duties_follow_the_office() {
        let swap = Change { release: vec![ChargeId(1)], elect: vec![elect("tesorero", "Ana Rojas")], ..Change::default() };
        let swapped = decide(&church(), BusinessMeeting, swap).unwrap();
        assert_eq!(swapped.charges().iter().map(|c| c.id).collect::<Vec<_>>(), [ChargeId(2)]);

        let duties = r#"{"offices":[{"id":"tesorero","name":"Tesorero","board_member":true,
                         "responsibilities":[{"summary":"Informe mensual a la junta"}]}]}"#;
        let next = decide(&swapped, BusinessMeeting, Change { catalog: catalog(duties), ..Change::default() }).unwrap();
        let summaries: Vec<_> = next.charges()[0].responsibilities.iter().map(|r| r.summary.as_str()).collect();
        assert_eq!(summaries, ["Informe mensual a la junta"]);
    }

    #[test]
    fn replay_adds_up_to_the_votes_applied_one_by_one() {
        let initial = Change { church: Some("Iglesia".into()), elect: vec![elect("tesorero", "Luis Pérez")], ..Change::default() };
        let votes = [
            Change {
                catalog: catalog(r#"{"hide":["club-de-aventureros"],"offices":[{"id":"bienvenida","name":"Bienvenida","board_member":false}]}"#),
                elect: vec![elect("bienvenida", "Carlos Díaz")],
                ..Change::default()
            },
            Change {
                church: Some("Iglesia Central".into()),
                catalog: catalog(r#"{"restore":["club-de-aventureros"]}"#),
                release: vec![ChargeId(1)],
                ..Change::default()
            },
        ];
        let mut stepped = Setup::initial(&initial).unwrap();
        let mut history = vec![entry(1, Approval::Initial, initial)];
        for change in votes {
            stepped = decide(&stepped, BusinessMeeting, change.clone()).unwrap();
            history.push(entry(stepped.latest().0, Approval::Vote(vote(BusinessMeeting)), change));
        }

        let replayed = Setup::replay(&history).unwrap();
        assert_eq!((replayed.latest(), replayed.church()), (EntryId(3), "Iglesia Central"));
        assert_eq!(replayed.catalog().layers.last().map(String::as_str), Some("Iglesia Central"), "a rename renames the church's layer");
        assert_eq!(replayed.charges().iter().map(|c| c.id).collect::<Vec<_>>(), [ChargeId(2)]);
        assert_eq!(json(replayed.catalog()), json(stepped.catalog()));
        assert_eq!(json(replayed.charges()), json(stepped.charges()));
    }

    #[test]
    fn rows_stored_by_this_version_keep_replaying() {
        let stored = |id, approval, change: &str| entry(id, approval, serde_json::from_str(change).unwrap());
        let history = [
            stored(
                1,
                Approval::Initial,
                r#"{"church":"Iglesia","catalog":{"offices":[],"hide":["hogar-y-escuela"],"restore":[],"board_agenda":null},
                    "elect":[{"office":"primer-anciano","holder":{"name":"Ana Rojas","email":"ana@example.org"},
                              "term":{"start_year":2026,"length":"one_year","extended":false}}],"release":[]}"#,
            ),
            stored(
                2,
                Approval::Vote(vote(Board)),
                r#"{"church":null,"catalog":{"offices":[],"hide":[],"restore":[],
                    "board_agenda":[{"id":"oracion","title":"Oración","page":null}]},"elect":[],"release":[]}"#,
            ),
        ];
        let setup = Setup::replay(&history).unwrap();
        assert_eq!(setup.charges()[0].holder.email.as_deref(), Some("ana@example.org"));
        assert_eq!(setup.catalog().board_agenda.len(), 1);
        assert!(setup.catalog().office(&"hogar-y-escuela".into()).is_none());
    }

    #[test]
    fn replay_accepts_any_recorded_history_and_refuses_what_is_not_one() {
        let initial = entry(1, Approval::Initial, Change { church: Some("Iglesia".into()), ..Change::default() });
        let election = Change { elect: vec![elect("secretario", "Ana Rojas")], ..Change::default() };
        let recorded_before_a_rule = [initial.clone(), entry(2, Approval::Vote(vote(Board)), election.clone())];
        assert_eq!(Setup::replay(&recorded_before_a_rule).unwrap().charges().len(), 1);

        assert_eq!(Setup::replay(&[]).unwrap_err(), SetupError::NoSetup);
        for history in [
            vec![initial.clone(), entry(2, Approval::Initial, election.clone())],
            vec![initial, entry(3, Approval::Vote(vote(BusinessMeeting)), election.clone())],
            vec![entry(1, Approval::Vote(vote(BusinessMeeting)), election)],
        ] {
            assert!(matches!(Setup::replay(&history), Err(SetupError::Malformed(_))), "{history:?}");
        }
    }
}
