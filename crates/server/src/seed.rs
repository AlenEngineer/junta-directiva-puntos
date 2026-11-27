//! How an empty database gets its first church setup from SETUP_FILE, once.

use std::path::Path;

use domain::{
    NewCharge,
    catalog::Layer,
    setup::{Change, Setup},
};
use serde::Deserialize;

use crate::store::Store;

#[derive(Deserialize)]
struct SetupFile {
    church: String,
    /// The church's own layer file, relative to the setup file. At most one,
    /// because the church's setup is one layer, named for the church.
    #[serde(default)]
    layers: Vec<String>,
    #[serde(default)]
    charges: Vec<NewCharge>,
}

/// The church's setup. A database that has none is seeded from the file at
/// `path`, once. After that the database is the source and the file is not
/// read at all.
pub async fn ensure(store: &Store, path: &Path) -> Result<Setup, String> {
    if let Some(setup) = store.setup().await.map_err(|e| e.to_string())? {
        return Ok(setup);
    }
    store.seed(&read(path)?).await.map_err(|e| format!("{}: {e}", path.display()))?;
    store.setup().await.map_err(|e| e.to_string())?.ok_or_else(|| "the setup is missing right after seeding".to_owned())
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The setup file as the initial change. Private, so the file is reached
/// only through `ensure` and nothing re-reads it to refresh a setup.
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

#[cfg(test)]
mod tests {
    use domain::{catalog::OfficeId, setup::EntryId};

    use super::*;
    use crate::store::tests::TempDatabase;

    fn examples() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
    }

    #[tokio::test]
    async fn the_setup_file_seeds_an_empty_database_and_is_ignored_after() {
        let database = TempDatabase::new("seed-once");
        let setup = ensure(&Store::open(&database.url()).await.unwrap(), &examples().join("setup.json")).await.unwrap();
        assert_eq!((setup.church(), setup.latest()), ("Iglesia de ejemplo", EntryId(1)));
        assert_eq!(setup.catalog().layers.len(), 2);
        let multimedia = setup.catalog().office(&OfficeId::from("multimedia")).expect("the church layer adds it");
        assert_eq!(multimedia.layer, "Iglesia de ejemplo");
        assert!(setup.catalog().office(&OfficeId::from("hogar-y-escuela")).is_none());
        assert_eq!((setup.charges()[0].office.0.as_str(), setup.charges()[0].holder.name.as_str()), ("primer-anciano", "Hermano de ejemplo"));

        let store = Store::open(&database.url()).await.unwrap();
        let restarted = ensure(&store, &examples().join("no-such-file.json")).await.unwrap();
        assert_eq!((restarted.church(), restarted.latest()), ("Iglesia de ejemplo", EntryId(1)));
        assert_eq!(store.history().await.unwrap().len(), 1);
    }
}
