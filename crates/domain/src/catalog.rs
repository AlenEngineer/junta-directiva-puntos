//! The offices and board agenda a church works with, built from layers:
//! the Church Manual first, then any division supplement, then the
//! church's own adjustments. A layer is data, so none of this needs a
//! rebuild to change.

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

/// What a layer, or a vote, changes in the catalog. One definition for both,
/// so a new kind of catalog change reaches layer files and votes together.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CatalogEdit {
    /// Added, or replacing the office with the same id.
    #[serde(default)]
    pub offices: Vec<CatalogOffice>,
    /// Offices this church does not use.
    #[serde(default)]
    pub hide: Vec<OfficeId>,
    /// Hidden offices the church uses again, as they were when hidden.
    #[serde(default)]
    pub restore: Vec<OfficeId>,
    /// Replaces the whole agenda template when present.
    #[serde(default)]
    pub board_agenda: Option<Vec<AgendaSection>>,
}

impl CatalogEdit {
    pub fn is_empty(&self) -> bool {
        let Self { offices, hide, restore, board_agenda } = self;
        offices.is_empty() && hide.is_empty() && restore.is_empty() && board_agenda.is_none()
    }
}

/// One source of offices and agenda, applied over the layers before it.
#[derive(Debug, Clone, Deserialize)]
pub struct Layer {
    pub name: String,
    #[serde(flatten)]
    pub edit: CatalogEdit,
}

impl Layer {
    pub fn manual_2025() -> Self {
        Self::parse(include_str!("../data/manual-2025.json")).expect("bundled manual layer is valid JSON")
    }

    pub fn parse(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Catalog {
    /// Layer names in the order they were applied. A layer applied in
    /// several steps, as a church's votes are, is listed once.
    pub layers: Vec<String>,
    pub offices: Vec<CatalogOffice>,
    /// Offices the church hid, kept so a later change can restore them.
    pub hidden: Vec<CatalogOffice>,
    pub board_agenda: Vec<AgendaSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CatalogOffice {
    pub id: OfficeId,
    pub name: String,
    /// Page in the layer's document, when it has one.
    pub page: Option<u16>,
    /// The vote that created the office, for offices a church adds.
    pub approved_by: Option<String>,
    /// A designation within another office, such as first elder among elders.
    pub variant_of: Option<OfficeId>,
    pub board_member: bool,
    #[serde(default)]
    pub responsibilities: Vec<Responsibility>,
    /// The layer this office came from. Set when layers are applied.
    #[serde(default)]
    pub layer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgendaSection {
    pub id: SectionId,
    pub title: String,
    /// Absent for sections that come from local practice, not a document.
    pub page: Option<u16>,
}

impl Catalog {
    pub fn manual_2025() -> Self {
        Self::from_layers([Layer::manual_2025()]).expect("bundled manual layer is valid")
    }

    pub fn from_layers(layers: impl IntoIterator<Item = Layer>) -> Result<Self, String> {
        let mut catalog = Self { layers: Vec::new(), offices: Vec::new(), hidden: Vec::new(), board_agenda: Vec::new() };
        for layer in layers {
            catalog.apply(layer)?;
        }
        catalog.validate()?;
        Ok(catalog)
    }

    fn apply(&mut self, layer: Layer) -> Result<(), String> {
        let Layer { name, edit } = layer;
        let mut seen = HashSet::new();
        if let Some(dup) = edit.offices.iter().find(|o| !seen.insert(&o.id)) {
            return Err(format!("{name}: office {} appears twice", dup.id.0));
        }
        for id in &edit.hide {
            let Some(at) = self.offices.iter().position(|o| &o.id == id) else {
                return Err(format!("{name}: cannot hide unknown office {}", id.0));
            };
            self.hidden.push(self.offices.remove(at));
        }
        for id in &edit.restore {
            let Some(at) = self.hidden.iter().position(|o| &o.id == id) else {
                return Err(format!("{name}: cannot restore office {}, which is not hidden", id.0));
            };
            self.offices.push(self.hidden.remove(at));
        }
        for mut office in edit.offices {
            office.layer = name.clone();
            self.hidden.retain(|o| o.id != office.id);
            match self.offices.iter_mut().find(|o| o.id == office.id) {
                Some(existing) => *existing = office,
                None => self.offices.push(office),
            }
        }
        if let Some(agenda) = edit.board_agenda {
            self.board_agenda = agenda;
        }
        if self.layers.last() != Some(&name) {
            self.layers.push(name);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
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

    fn layer(json: &str) -> Layer {
        Layer::parse(json).unwrap()
    }

    fn with_church(json: &str) -> Result<Catalog, String> {
        Catalog::from_layers([Layer::manual_2025(), layer(json)])
    }

    #[test]
    fn the_bundled_manual_loads() {
        let catalog = Catalog::manual_2025();
        assert!(catalog.offices.len() >= 30, "{} offices", catalog.offices.len());
        assert_eq!(catalog.board_agenda.first().map(|s| s.id.0.as_str()), Some("devocional"));
        assert!(catalog.offices.iter().all(|o| o.layer == catalog.layers[0]));
    }

    #[test]
    fn a_church_adds_a_local_office_and_it_records_where_it_came_from() {
        let catalog = with_church(
            r#"{"name":"Iglesia Central","offices":[{"id":"multimedia","name":"Coordinador de multimedia","approved_by":"Reunión administrativa 2026-01-10","board_member":false}]}"#,
        )
        .unwrap();
        let office = catalog.office(&OfficeId::from("multimedia")).expect("added");
        assert_eq!(office.layer, "Iglesia Central");
        assert_eq!(catalog.layers.last().map(String::as_str), Some("Iglesia Central"));
    }

    #[test]
    fn a_church_replaces_an_office_by_id_without_duplicating_it() {
        let catalog = with_church(
            r#"{"name":"c","offices":[{"id":"tesorero","name":"Tesorero","page":104,"board_member":true,"responsibilities":[{"summary":"Informe mensual a la junta"}]}]}"#,
        )
        .unwrap();
        let matches: Vec<_> = catalog.offices.iter().filter(|o| o.id.0 == "tesorero").collect();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].responsibilities[0].summary, "Informe mensual a la junta");
    }

    #[test]
    fn a_church_hides_offices_it_does_not_use() {
        let catalog = with_church(r#"{"name":"c","hide":["club-de-aventureros"]}"#).unwrap();
        assert!(catalog.office(&OfficeId::from("club-de-aventureros")).is_none());
        assert!(catalog.hidden.iter().any(|o| o.id.0 == "club-de-aventureros"));
    }

    #[test]
    fn a_hidden_office_is_restored_as_the_manual_defines_it() {
        let catalog = Catalog::from_layers([
            Layer::manual_2025(),
            layer(r#"{"name":"c","hide":["club-de-aventureros"]}"#),
            layer(r#"{"name":"c","restore":["club-de-aventureros"]}"#),
        ])
        .unwrap();
        let office = catalog.office(&OfficeId::from("club-de-aventureros")).expect("restored");
        assert_eq!((office.page, office.layer.as_str()), (Some(138), catalog.layers[0].as_str()));
        assert!(catalog.hidden.is_empty());
    }

    #[test]
    fn restoring_an_office_that_is_not_hidden_is_an_error() {
        let err = with_church(r#"{"name":"c","restore":["club-de-aventureros"]}"#).unwrap_err();
        assert_eq!(err, "c: cannot restore office club-de-aventureros, which is not hidden");
    }

    #[test]
    fn a_new_definition_of_a_hidden_office_puts_it_back_in_use() {
        let catalog = Catalog::from_layers([
            Layer::manual_2025(),
            layer(r#"{"name":"c","hide":["club-de-aventureros"]}"#),
            layer(r#"{"name":"c","offices":[{"id":"club-de-aventureros","name":"Aventureros","board_member":false}]}"#),
        ])
        .unwrap();
        assert_eq!(catalog.office(&OfficeId::from("club-de-aventureros")).map(|o| o.name.as_str()), Some("Aventureros"));
        assert!(catalog.hidden.is_empty());
    }

    #[test]
    fn a_layer_applied_in_several_steps_is_listed_once() {
        let catalog = Catalog::from_layers([
            Layer::manual_2025(),
            layer(r#"{"name":"c","hide":["club-de-aventureros"]}"#),
            layer(r#"{"name":"c","board_agenda":[{"id":"oracion","title":"Oración"}]}"#),
        ])
        .unwrap();
        assert_eq!(catalog.layers.len(), 2);
    }

    #[test]
    fn hiding_an_unknown_office_is_an_error_so_typos_surface() {
        let err = with_church(r#"{"name":"c","hide":["club-de-aventurero"]}"#).unwrap_err();
        assert!(err.contains("unknown office club-de-aventurero"), "{err}");
    }

    #[test]
    fn hiding_a_base_office_while_its_variant_remains_is_rejected() {
        let err = with_church(r#"{"name":"c","hide":["anciano"]}"#).unwrap_err();
        assert!(err.contains("variant of unknown anciano"), "{err}");
    }

    #[test]
    fn a_church_replaces_the_agenda_template() {
        let catalog = with_church(r#"{"name":"c","board_agenda":[{"id":"oracion","title":"Oración"}]}"#).unwrap();
        assert_eq!(catalog.board_agenda.len(), 1);
    }

    #[test]
    fn a_layer_listing_the_same_office_twice_is_rejected() {
        let err = Catalog::from_layers([layer(
            r#"{"name":"x","offices":[{"id":"a","name":"A","board_member":true},{"id":"a","name":"B","board_member":true}]}"#,
        )])
        .unwrap_err();
        assert!(err.contains("office a appears twice"), "{err}");
    }
}
