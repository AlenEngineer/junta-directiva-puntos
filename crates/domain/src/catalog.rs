//! The offices and board agenda the Church Manual describes, loaded from
//! data so a new edition or a division supplement is a data change.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Responsibility;
use crate::agenda::SectionId;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OfficeId(pub String);

impl From<&str> for OfficeId {
    fn from(id: &str) -> Self {
        Self(id.to_owned())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Catalog {
    pub edition: String,
    pub offices: Vec<CatalogOffice>,
    pub board_agenda: Vec<AgendaSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CatalogOffice {
    pub id: OfficeId,
    pub name: String,
    pub page: u16,
    /// A designation within another office, such as first elder among elders.
    pub variant_of: Option<OfficeId>,
    pub board_member: bool,
    #[serde(default)]
    pub responsibilities: Vec<Responsibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgendaSection {
    pub id: SectionId,
    pub title: String,
    /// Absent for sections that come from local practice, not the manual.
    pub page: Option<u16>,
}

impl Catalog {
    pub fn manual_2025() -> Self {
        Self::parse(include_str!("../data/manual-2025.json")).expect("bundled catalog is valid")
    }

    pub fn parse(json: &str) -> Result<Self, String> {
        let catalog: Self = serde_json::from_str(json).map_err(|e| e.to_string())?;
        catalog.validate()?;
        Ok(catalog)
    }

    fn validate(&self) -> Result<(), String> {
        let mut ids = HashSet::new();
        for office in &self.offices {
            if !ids.insert(&office.id) {
                return Err(format!("duplicate office {}", office.id.0));
            }
        }
        for office in &self.offices {
            if let Some(base) = &office.variant_of {
                match self.office(base) {
                    None => return Err(format!("{} is a variant of unknown {}", office.id.0, base.0)),
                    Some(b) if b.variant_of.is_some() => {
                        return Err(format!("{} is a variant of a variant", office.id.0));
                    }
                    Some(_) => {}
                }
            }
        }
        let mut sections = HashSet::new();
        for section in &self.board_agenda {
            if !sections.insert(&section.id) {
                return Err(format!("duplicate agenda section {}", section.id.0));
            }
        }
        Ok(())
    }

    pub fn office(&self, id: &OfficeId) -> Option<&CatalogOffice> {
        self.offices.iter().find(|o| &o.id == id)
    }

    pub fn default_responsibilities(&self, id: &OfficeId) -> Option<Vec<Responsibility>> {
        let office = self.office(id)?;
        let base = office.variant_of.as_ref().and_then(|b| self.office(b));
        Some(
            base.into_iter()
                .chain([office])
                .flat_map(|o| o.responsibilities.iter().cloned())
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_catalog_loads() {
        let catalog = Catalog::manual_2025();
        assert!(catalog.offices.len() >= 30, "{} offices", catalog.offices.len());
        assert_eq!(catalog.board_agenda.first().map(|s| s.id.0.as_str()), Some("devocional"));
    }

    #[test]
    fn a_catalog_with_a_dangling_variant_is_rejected() {
        let json = r#"{"edition":"x","offices":[{"id":"a","name":"A","page":1,"variant_of":"b","board_member":true}],"board_agenda":[]}"#;
        assert!(Catalog::parse(json).unwrap_err().contains("unknown b"));
    }

    #[test]
    fn a_catalog_with_a_duplicate_office_is_rejected() {
        let json = r#"{"edition":"x","offices":[{"id":"a","name":"A","page":1,"board_member":true},{"id":"a","name":"A","page":2,"board_member":true}],"board_agenda":[]}"#;
        assert!(Catalog::parse(json).unwrap_err().contains("duplicate office"));
    }
}
