//! The charges the user holds in a local church, and what each one covers.
//!
//! Types here are the single source of truth. `cargo test` exports them to
//! `web/src/generated`, so the web app never hand-copies a shape.

pub mod access;
pub mod agenda;
pub mod catalog;
pub mod setup;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use catalog::{Catalog, OfficeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChargeId(pub u32);

/// An office held for a term. Its responsibilities start from the catalog
/// and the church adjusts them to how it actually works.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Charge {
    pub id: ChargeId,
    pub office: OfficeId,
    pub holder: Holder,
    pub term: Term,
    pub responsibilities: Vec<Responsibility>,
}

impl Charge {
    /// A charge for an office in the catalog, with its responsibilities.
    /// A variant such as first elder also carries the base office's.
    pub fn from_catalog(catalog: &Catalog, id: ChargeId, new: &NewCharge) -> Option<Self> {
        Some(Self {
            id,
            office: new.office.clone(),
            holder: new.holder.clone(),
            term: new.term,
            responsibilities: catalog.default_responsibilities(&new.office)?,
        })
    }

    pub fn modules(&self) -> impl Iterator<Item = Module> + '_ {
        self.responsibilities.iter().filter_map(|r| r.module)
    }

    /// Whether the holder serves in church year `year`. A charge serves
    /// through its term, and after it until the church elects a successor:
    /// a charge among `charges` for the same office whose term starts after
    /// this one's last year. An officer stops when a successor is elected
    /// (pp. 91-92), so a church that has not yet recorded its election
    /// keeps its officers.
    pub fn serves_in(&self, year: u16, charges: &[Charge]) -> bool {
        let last = self.term.last_year();
        let succeeded = charges.iter().any(|c| c.office == self.office && c.term.start_year > last);
        self.term.start_year <= year && (year <= last || !succeeded)
    }
}

/// A charge as a vote elects it, or as the setup file lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewCharge {
    pub office: OfficeId,
    pub holder: Holder,
    pub term: Term,
}

/// Who holds a charge. Signing in matches the signed-in email to the
/// charges held, so the setup keeps the email as `normalize_email` leaves it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Holder {
    pub name: String,
    pub email: Option<String>,
}

impl Holder {
    pub(crate) fn normalized(&self) -> Self {
        Self { name: self.name.trim().to_owned(), email: self.email.as_deref().map(normalize_email).filter(|e| !e.is_empty()) }
    }
}

/// How emails compare: trimmed and lowercased. Holders' emails are kept
/// this way, and a signed-in email is matched this way.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Responsibility {
    pub summary: String,
    /// Page in the catalog's edition, when the manual states it.
    pub page: Option<u16>,
    /// The module this responsibility is carried out in, if any.
    pub module: Option<Module>,
}

/// One year by default; two when the business meeting votes it (p. 91).
/// Years are church years, so with a church year that starts in October,
/// a one-year term from 2026 runs from 2026-10-01 to 2027-09-30.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Term {
    /// The church year the term starts in, named for the calendar year it begins in.
    pub start_year: u16,
    #[serde(default)]
    pub length: TermLength,
    /// The exceptional one-year extension agreed with the conference.
    #[serde(default)]
    pub extended: bool,
}

impl Term {
    pub fn one_year(start_year: u16) -> Self {
        Self { start_year, length: TermLength::OneYear, extended: false }
    }

    pub fn last_year(self) -> u16 {
        let years = match self.length {
            TermLength::OneYear => 1,
            TermLength::TwoYears => 2,
        } + u16::from(self.extended);
        self.start_year + years - 1
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TermLength {
    #[default]
    OneYear,
    TwoYears,
}

/// A month of the year, from 1 (January) to 12 (December).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[ts(export, type = "number")]
pub struct Month(u8);

impl Month {
    pub const JANUARY: Self = Self(1);
}

impl Default for Month {
    fn default() -> Self {
        Self::JANUARY
    }
}

impl TryFrom<u8> for Month {
    type Error = String;

    fn try_from(number: u8) -> Result<Self, String> {
        match number {
            1..=12 => Ok(Self(number)),
            _ => Err(format!("{number} is not a month; months go from 1 to 12")),
        }
    }
}

impl<'de> Deserialize<'de> for Month {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(u8::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A calendar day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Date {
    pub year: u16,
    pub month: Month,
    pub day: u8,
}

impl Date {
    /// The UTC day of a Unix time: Howard Hinnant's `civil_from_days`.
    pub fn from_unix_seconds(seconds: i64) -> Self {
        let z = seconds.div_euclid(86_400) + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = era * 400 + yoe + i64::from(month <= 2);
        Self { year: year as u16, month: Month(month as u8), day: day as u8 }
    }
}

/// The church year `today` falls in, named for the calendar year it began
/// in. With a church year that starts in October, church year 2026 runs
/// from 2026-10-01 to 2027-09-30.
pub fn church_year(today: Date, year_starts: Month) -> u16 {
    if today.month >= year_starts { today.year } else { today.year - 1 }
}

/// Work the app supports. A module is behavior, so it lives in code; which
/// charges use it is data, through their responsibilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Module {
    Agenda,
}

/// `YYYY-MM-DD`, by shape only. Meetings and votes share this one date rule.
pub(crate) fn is_iso_date(date: &str) -> bool {
    date.len() == 10 && date.char_indices().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elder(office: &str) -> NewCharge {
        NewCharge {
            office: OfficeId::from(office),
            holder: Holder { name: "Hermano de ejemplo".into(), email: None },
            term: Term::one_year(2026),
        }
    }

    #[test]
    fn a_charge_serves_through_its_term_and_until_a_successor_is_elected() {
        let held = |office: &str, term: Term| Charge {
            id: ChargeId(0),
            office: OfficeId::from(office),
            holder: Holder { name: "Hermano de ejemplo".into(), email: None },
            term,
            responsibilities: vec![],
        };
        let clerk = held("secretario", Term::one_year(2026));
        let two_years = held("tesorero", Term { start_year: 2025, length: TermLength::TwoYears, extended: false });
        for (case, charge, later, year, serves) in [
            ("before its term starts", &clerk, None, 2025, false),
            ("during its term", &clerk, None, 2026, true),
            ("in the last year of a two-year term", &two_years, None, 2026, true),
            ("after its term, with no successor elected", &clerk, None, 2027, true),
            ("after its term, with a successor elected", &clerk, Some(held("secretario", Term::one_year(2027))), 2027, false),
            ("before its successor's term starts", &clerk, Some(held("secretario", Term::one_year(2027))), 2026, true),
            ("after its term, beside a later charge for another office", &clerk, Some(held("tesorero", Term::one_year(2027))), 2027, true),
            ("after its term, beside a charge for the same years", &clerk, Some(held("secretario", Term::one_year(2026))), 2027, true),
        ] {
            let charges: Vec<Charge> = [charge.clone()].into_iter().chain(later).collect();
            assert_eq!(charge.serves_in(year, &charges), serves, "{case}");
        }
    }

    #[test]
    fn a_term_covers_its_length_plus_any_extension() {
        assert_eq!(Term::one_year(2026).last_year(), 2026);
        let two = Term { start_year: 2026, length: TermLength::TwoYears, extended: true };
        assert_eq!(two.last_year(), 2028);
    }

    fn day(year: u16, month: u8, day: u8) -> Date {
        Date { year, month: Month(month), day }
    }

    #[test]
    fn the_church_year_starts_in_the_month_the_church_chose() {
        for (today, year_starts, church) in [
            (day(2026, 1, 1), Month::JANUARY, 2026),
            (day(2026, 12, 31), Month::JANUARY, 2026),
            (day(2026, 9, 30), Month(10), 2025),
            (day(2026, 10, 1), Month(10), 2026),
            (day(2027, 1, 15), Month(10), 2026),
        ] {
            assert_eq!(church_year(today, year_starts), church, "{today:?} with the year starting in {year_starts:?}");
        }
    }

    #[test]
    fn a_unix_time_falls_on_its_utc_day() {
        for (seconds, expected) in [
            (0, day(1970, 1, 1)),
            (-1, day(1969, 12, 31)),
            (951_782_400, day(2000, 2, 29)),
            (1_767_225_599, day(2025, 12, 31)),
            (1_767_225_600, day(2026, 1, 1)),
            (1_790_812_799, day(2026, 9, 30)),
            (1_790_812_800, day(2026, 10, 1)),
            (1_799_971_200, day(2027, 1, 15)),
            (4_107_542_400, day(2100, 3, 1)),
        ] {
            assert_eq!(Date::from_unix_seconds(seconds), expected, "{seconds}");
        }
    }

    #[test]
    fn a_month_is_from_1_to_12() {
        assert_eq!(serde_json::from_str::<Month>("10").unwrap(), Month(10));
        for bad in ["0", "13"] {
            assert!(serde_json::from_str::<Month>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_first_elder_inherits_the_elder_duties_and_runs_the_agenda() {
        let catalog = Catalog::manual_2025();
        let charge = Charge::from_catalog(&catalog, ChargeId(1), &elder("primer-anciano")).expect("first elder is in the catalog");
        let summaries: Vec<_> = charge.responsibilities.iter().map(|r| r.summary.as_str()).collect();
        assert!(summaries.contains(&"Dirigir los cultos de la iglesia"), "{summaries:?}");
        assert!(summaries.contains(&"Presidir la junta directiva cuando el pastor lo pida"), "{summaries:?}");
        assert_eq!(charge.modules().collect::<Vec<_>>(), vec![Module::Agenda]);
    }

    #[test]
    fn an_unknown_office_is_not_a_catalog_charge() {
        let catalog = Catalog::manual_2025();
        assert!(Charge::from_catalog(&catalog, ChargeId(1), &elder("obispo")).is_none());
    }
}
