//! Who is asking and what they may do. Nothing here is stored. The server
//! builds a `Viewer` for every request from the person signed in and the
//! setup, so the next vote that elects or releases someone changes what
//! they may do on their next request.

use serde::Serialize;
use ts_rs::TS;

use crate::catalog::Catalog;
use crate::setup::Setup;
use crate::{Charge, ChargeId, Date, Module, church_year, normalize_email};

/// The offices whose holder records the church's votes and invites holders
/// to sign in. The clerk records the church's decisions (pp. 103-104, 167),
/// and the first elder chairs the board when the pastor asks (p. 167).
/// Named by id, so no catalog edit can take this away.
const RECORDERS: [&str; 2] = ["secretario", "primer-anciano"];

/// Who signed in, as the identity provider vouches for them.
#[derive(Debug, Clone)]
pub struct Person {
    pub email: String,
    pub name: String,
}

/// Who is asking and what they may do. `GET /api/me` serves it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Viewer {
    /// Trimmed and lowercased, as holders' emails are kept.
    pub email: String,
    pub name: String,
    /// The charges held under this email that serve today, each with
    /// what it alone allows, so each opens its own desk.
    pub desks: Vec<Desk>,
    /// Everything the desks allow together, or everything for the developer.
    pub may: May,
}

/// One serving charge and what that charge alone allows. The page lays
/// out a desk's work from `may`, so it never repeats the rule here.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Desk {
    pub charge: Charge,
    pub may: May,
}

impl Viewer {
    /// `person` as `setup` knows them on `today`. `developer` is the
    /// deploy's developer email: signed in like anyone else, the developer
    /// may do everything, whatever they hold. This function is the whole
    /// rule. Nothing else decides what a person may do.
    pub fn new(setup: &Setup, person: Person, today: Date, developer: Option<&str>) -> Self {
        let email = normalize_email(&person.email);
        let year = church_year(today, setup.year_starts());
        let desks: Vec<Desk> = setup
            .charges()
            .iter()
            .filter(|c| c.holder.email.as_deref() == Some(email.as_str()) && c.serves_in(year, setup.charges()))
            .map(|c| Desk { charge: c.clone(), may: May::of(c, setup.catalog()) })
            .collect();
        let may = if is_developer(&email, developer) {
            May::EVERYTHING
        } else {
            desks.iter().map(|d| d.may).fold(May::default(), May::or)
        };
        Self { email, name: person.name, desks, may }
    }

    /// `person` before the church has a setup. Nobody holds anything yet,
    /// so the developer may only start the setup, and anyone else may do
    /// nothing.
    pub fn before_setup(person: Person, developer: Option<&str>) -> Self {
        let email = normalize_email(&person.email);
        let may = May { start_setup: is_developer(&email, developer), ..May::default() };
        Self { email, name: person.name, desks: Vec::new(), may }
    }
}

fn is_developer(email: &str, developer: Option<&str>) -> bool {
    developer.map(normalize_email).is_some_and(|d| !d.is_empty() && d == email)
}

/// What a viewer may do. Each field unlocks one group of routes and is
/// named for it. The server checks exactly one field per route, and the
/// page reads the same fields to show only what will work.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct May {
    /// See the church's setup and its history. Any charge that serves.
    pub read_setup: bool,
    /// Record the church's votes, and invite a charge's holder to sign in.
    pub record_votes: bool,
    /// See the board's meetings. A board member, or whoever runs the board.
    pub read_board: bool,
    /// Create board meetings, edit their items, call them and mark them held.
    pub run_board: bool,
    /// Enter the church's first setup: the developer, while the church has none.
    pub start_setup: bool,
}

impl May {
    /// The developer's exception, once the church has a setup. A struct
    /// literal, so a new field does not compile until it is listed here.
    /// A setup exists, so there is none left to start.
    pub const EVERYTHING: Self = Self { read_setup: true, record_votes: true, read_board: true, run_board: true, start_setup: false };

    /// What one serving charge allows. A struct literal for the same reason:
    /// a new field does not compile until it has its rule.
    fn of(charge: &Charge, catalog: &Catalog) -> Self {
        let runs_board = charge.modules().any(|m| m == Module::Agenda);
        let on_board = catalog.office(&charge.office).is_some_and(|o| o.board_member);
        Self {
            read_setup: true,
            record_votes: RECORDERS.contains(&charge.office.0.as_str()),
            read_board: on_board || runs_board,
            run_board: runs_board,
            start_setup: false,
        }
    }

    /// Everything either allows. Destructured in full, so a new field
    /// cannot be left out of the merge.
    fn or(self, other: Self) -> Self {
        let Self { read_setup, record_votes, read_board, run_board, start_setup } = self;
        Self {
            read_setup: read_setup || other.read_setup,
            record_votes: record_votes || other.record_votes,
            read_board: read_board || other.read_board,
            run_board: run_board || other.run_board,
            start_setup: start_setup || other.start_setup,
        }
    }
}

/// An invitation WorkOS emailed to a charge's holder so they can sign up.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Invitation {
    pub charge: ChargeId,
    pub email: String,
    /// When the invitation stops working, as WorkOS reports it (UTC, ISO 8601).
    pub expires_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::OfficeId;
    use crate::setup::Change;
    use crate::{Holder, Month, NewCharge, Term};

    const TODAY: Date = Date { year: 2026, month: Month(12), day: 6 };

    /// A church whose own layer adds a multimedia office off the board.
    fn church(year_starts: Month, charges: Vec<NewCharge>) -> Setup {
        let multimedia = r#"{"offices":[{"id":"multimedia","name":"Coordinador de multimedia","board_member":false}]}"#;
        let change = Change {
            church: Some("Iglesia".into()),
            year_starts: Some(year_starts),
            catalog: serde_json::from_str(multimedia).unwrap(),
            elect: charges,
            ..Change::default()
        };
        Setup::initial(&change).unwrap()
    }

    fn holding(office: &str, email: &str, start_year: u16) -> NewCharge {
        NewCharge {
            office: OfficeId::from(office),
            holder: Holder { name: "Hermano de ejemplo".into(), email: Some(email.into()) },
            term: Term::one_year(start_year),
        }
    }

    fn person(email: &str) -> Person {
        Person { email: email.into(), name: "Hermano de ejemplo".into() }
    }

    fn officers() -> Setup {
        church(
            Month::JANUARY,
            vec![
                holding("secretario", "ana@example.org", 2026),
                holding("tesorero", "luis@example.org", 2026),
                holding("multimedia", "marta@example.org", 2026),
                holding("primer-anciano", "pedro@example.org", 2026),
                holding("anciano", "elena@example.org", 2026),
            ],
        )
    }

    fn may(setup: &Setup, email: &str) -> May {
        Viewer::new(setup, person(email), TODAY, None).may
    }

    #[test]
    fn the_clerk_and_the_first_elder_record_votes_and_nobody_else_does() {
        let setup = officers();
        let recorders = ["ana", "luis", "marta", "pedro", "elena"].map(|who| may(&setup, &format!("{who}@example.org")).record_votes);
        assert_eq!(recorders, [true, false, false, true, false]);
    }

    #[test]
    fn each_desk_carries_only_what_its_own_charge_allows() {
        let setup = church(
            Month::JANUARY,
            vec![holding("secretario", "ana@example.org", 2026), holding("tesorero", "ana@example.org", 2026)],
        );
        let viewer = Viewer::new(&setup, person("ana@example.org"), TODAY, None);
        let recorders: Vec<(&str, bool)> = viewer.desks.iter().map(|d| (d.charge.office.0.as_str(), d.may.record_votes)).collect();
        assert_eq!(recorders, [("secretario", true), ("tesorero", false)]);
        assert!(viewer.may.record_votes);
    }

    #[test]
    fn board_members_read_meetings_and_the_agenda_module_runs_them() {
        let setup = officers();
        let board = |who: &str| {
            let may = may(&setup, &format!("{who}@example.org"));
            (may.read_board, may.run_board)
        };
        assert_eq!(board("luis"), (true, false), "the treasurer is on the board");
        assert_eq!(board("elena"), (true, false), "an elder is on the board");
        assert_eq!(board("pedro"), (true, true), "the first elder's charge carries the agenda");
    }

    #[test]
    fn an_office_off_the_board_reads_the_setup_and_not_the_meetings() {
        let marta = may(&officers(), "marta@example.org");
        assert_eq!(marta, May { read_setup: true, ..May::default() });
    }

    #[test]
    fn emails_match_whatever_their_case_and_spacing() {
        let setup = church(Month::JANUARY, vec![holding("tesorero", " Luis@Example.org ", 2026)]);
        let viewer = Viewer::new(&setup, person(" LUIS@example.ORG"), TODAY, None);
        assert_eq!((viewer.email.as_str(), viewer.desks.len()), ("luis@example.org", 1));
    }

    #[test]
    fn the_developer_may_do_everything_while_holding_nothing() {
        let viewer = Viewer::new(&officers(), person(" Dev@Example.org "), TODAY, Some("dev@example.org"));
        assert_eq!((viewer.may, viewer.desks.len()), (May::EVERYTHING, 0));
    }

    #[test]
    fn before_a_setup_exists_only_the_developer_may_start_one() {
        let dev = Viewer::before_setup(person(" Dev@Example.org "), Some("dev@example.org"));
        assert_eq!((dev.email.as_str(), dev.may), ("dev@example.org", May { start_setup: true, ..May::default() }));
        assert_eq!(Viewer::before_setup(person("ana@example.org"), Some("dev@example.org")).may, May::default());
        assert_eq!(Viewer::before_setup(person("ana@example.org"), None).may, May::default());
    }

    #[test]
    fn someone_the_setup_does_not_name_may_do_nothing() {
        let viewer = Viewer::new(&officers(), person("nadie@example.org"), TODAY, Some("dev@example.org"));
        assert_eq!((viewer.may, viewer.desks.len()), (May::default(), 0));
    }

    #[test]
    fn an_officer_whose_term_ended_serves_until_the_church_elects_a_successor() {
        let held_over = church(Month::JANUARY, vec![holding("secretario", "ana@example.org", 2025)]);
        assert!(may(&held_over, "ana@example.org").record_votes);
        let succeeded = church(
            Month::JANUARY,
            vec![holding("secretario", "ana@example.org", 2025), holding("secretario", "rosa@example.org", 2026)],
        );
        assert_eq!(may(&succeeded, "ana@example.org"), May::default());
        assert!(may(&succeeded, "rosa@example.org").record_votes);
    }

    #[test]
    fn a_charge_serves_from_the_start_of_its_church_year() {
        let mid_january = Date { year: 2027, month: Month::JANUARY, day: 15 };
        let serves = |year_starts, start_year| {
            let setup = church(year_starts, vec![holding("tesorero", "luis@example.org", start_year)]);
            !Viewer::new(&setup, person("luis@example.org"), mid_january, None).desks.is_empty()
        };
        assert!(serves(Month::JANUARY, 2027));
        assert!(!serves(Month(10), 2027), "church year 2027 starts in October 2027");
        assert!(serves(Month(10), 2026), "church year 2026 runs through September 2027");
    }

    #[test]
    fn the_offices_that_record_votes_are_in_the_bundled_manual() {
        let manual = crate::catalog::Catalog::manual_2025();
        for office in RECORDERS {
            assert!(manual.office(&OfficeId::from(office)).is_some(), "{office}");
        }
    }
}
