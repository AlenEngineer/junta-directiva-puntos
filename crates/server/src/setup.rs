//! A church's installation: its catalog layers and the charges held.

use std::path::Path;

use domain::{
    Charge, ChargeId, Term,
    catalog::{Catalog, Layer, OfficeId},
};
use serde::Deserialize;

#[derive(Deserialize)]
struct SetupFile {
    church: String,
    /// Layer files applied over the bundled manual, relative to the setup file.
    #[serde(default)]
    layers: Vec<String>,
    #[serde(default)]
    charges: Vec<ChargeSpec>,
}

#[derive(Deserialize)]
struct ChargeSpec {
    office: OfficeId,
    term: Term,
}

pub struct Setup {
    pub church: String,
    pub catalog: Catalog,
    pub charges: Vec<Charge>,
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn load(path: &Path) -> Result<Setup, String> {
    let file: SetupFile = serde_json::from_str(&read(path)?).map_err(|e| format!("{}: {e}", path.display()))?;
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut layers = vec![Layer::manual_2025()];
    for name in &file.layers {
        let layer_path = dir.join(name);
        layers.push(Layer::parse(&read(&layer_path)?).map_err(|e| format!("{}: {e}", layer_path.display()))?);
    }
    let catalog = Catalog::from_layers(layers)?;
    let charges = file
        .charges
        .into_iter()
        .zip(1..)
        .map(|(spec, n)| {
            Charge::from_catalog(&catalog, ChargeId(n), &spec.office, spec.term)
                .ok_or_else(|| format!("charge for unknown office {}", spec.office.0))
        })
        .collect::<Result<_, _>>()?;
    Ok(Setup { church: file.church, catalog, charges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_example_setup_loads_with_its_church_layer() {
        let setup = load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/setup.json")).unwrap();
        assert_eq!(setup.catalog.layers.len(), 2);
        assert!(setup.catalog.office(&OfficeId::from("multimedia")).is_some());
        assert!(setup.catalog.office(&OfficeId::from("hogar-y-escuela")).is_none());
        assert_eq!(setup.charges[0].office, OfficeId::from("primer-anciano"));
    }
}
