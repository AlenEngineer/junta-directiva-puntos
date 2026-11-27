//! The charges the user holds in a local church, and what each one covers.
//!
//! Types here are the single source of truth. `cargo test` exports them to
//! `web/src/generated`, so the web app never hand-copies a shape.

pub mod agenda;
pub mod catalog;

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
    pub term: Term,
    pub responsibilities: Vec<Responsibility>,
}

impl Charge {
    /// A charge for an office in the catalog, with its responsibilities.
    /// A variant such as first elder also carries the base office's.
    pub fn from_catalog(catalog: &Catalog, id: ChargeId, office: &OfficeId, term: Term) -> Option<Self> {
        Some(Self {
            id,
            office: office.clone(),
            term,
            responsibilities: catalog.default_responsibilities(office)?,
        })
    }

    pub fn modules(&self) -> impl Iterator<Item = Module> + '_ {
        self.responsibilities.iter().filter_map(|r| r.module)
    }
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Term {
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

/// Work the app supports. A module is behavior, so it lives in code; which
/// charges use it is data, through their responsibilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Module {
    Agenda,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_term_covers_its_length_plus_any_extension() {
        assert_eq!(Term::one_year(2026).last_year(), 2026);
        let two = Term { start_year: 2026, length: TermLength::TwoYears, extended: true };
        assert_eq!(two.last_year(), 2028);
    }

    #[test]
    fn a_first_elder_inherits_the_elder_duties_and_runs_the_agenda() {
        let catalog = Catalog::manual_2025();
        let charge = Charge::from_catalog(&catalog, ChargeId(1), &OfficeId::from("primer-anciano"), Term::one_year(2026))
            .expect("first elder is in the catalog");
        let summaries: Vec<_> = charge.responsibilities.iter().map(|r| r.summary.as_str()).collect();
        assert!(summaries.contains(&"Dirigir los cultos de la iglesia"), "{summaries:?}");
        assert!(summaries.contains(&"Presidir la junta directiva cuando el pastor lo pida"), "{summaries:?}");
        assert_eq!(charge.modules().collect::<Vec<_>>(), vec![Module::Agenda]);
    }

    #[test]
    fn an_unknown_office_is_not_a_catalog_charge() {
        let catalog = Catalog::manual_2025();
        assert!(Charge::from_catalog(&catalog, ChargeId(1), &OfficeId::from("obispo"), Term::one_year(2026)).is_none());
    }
}
