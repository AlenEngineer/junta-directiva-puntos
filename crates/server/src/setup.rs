//! A church's installation: its catalog layer and the charges held.

use std::path::Path;

use domain::{
    NewCharge,
    catalog::Layer,
    setup::{Change, Setup},
};
use serde::Deserialize;

#[derive(Deserialize)]
struct SetupFile {
    church: String,
    /// The church's own layer file, relative to the setup file. At most one:
    /// the church's setup is one layer, named for the church.
    #[serde(default)]
    layers: Vec<String>,
    #[serde(default)]
    charges: Vec<NewCharge>,
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The setup file as the first change of the church's setup.
fn read(path: &Path) -> Result<Change, String> {
    let file: SetupFile = serde_json::from_str(&read_text(path)?).map_err(|e| format!("{}: {e}", path.display()))?;
    let catalog = match file.layers.as_slice() {
        [] => Default::default(),
        [name] => {
            let layer_path = path.parent().unwrap_or(Path::new(".")).join(name);
            Layer::parse(&read_text(&layer_path)?).map_err(|e| format!("{}: {e}", layer_path.display()))?.edit
        }
        many => return Err(format!("{}: lists {} layer files; a church's setup has one", path.display(), many.len())),
    };
    Ok(Change { church: Some(file.church), catalog, elect: file.charges, release: Vec::new() })
}

pub fn load(path: &Path) -> Result<Setup, String> {
    Setup::initial(&read(path)?).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use domain::catalog::OfficeId;

    use super::*;

    #[test]
    fn the_example_setup_loads_with_its_church_layer() {
        let setup = load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/setup.json")).unwrap();
        assert_eq!(setup.catalog().layers.len(), 2);
        let multimedia = setup.catalog().office(&OfficeId::from("multimedia")).expect("the church layer adds it");
        assert_eq!(multimedia.layer, "Iglesia de ejemplo");
        assert!(setup.catalog().office(&OfficeId::from("hogar-y-escuela")).is_none());
        assert_eq!(setup.charges()[0].office, OfficeId::from("primer-anciano"));
        assert_eq!(setup.charges()[0].holder.name, "Hermano de ejemplo");
    }
}
