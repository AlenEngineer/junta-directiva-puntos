mod setup;

use std::{path::PathBuf, sync::Arc};

use axum::{Json, Router, extract::State, routing::get};
use domain::{Charge, agenda::Meeting, catalog::Catalog};
use serde_json::{Value, json};
use tokio::sync::RwLock;

/// In-memory until the persistence choice is made.
struct Store {
    church: String,
    catalog: Catalog,
    charges: Vec<Charge>,
    meetings: Vec<Meeting>,
}

type AppState = Arc<RwLock<Store>>;

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/church", get(church))
        .route("/api/catalog", get(catalog))
        .route("/api/charges", get(charges))
        .route("/api/meetings", get(meetings))
        .with_state(state)
}

async fn church(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "name": state.read().await.church }))
}

async fn catalog(State(state): State<AppState>) -> Json<Catalog> {
    Json(state.read().await.catalog.clone())
}

async fn charges(State(state): State<AppState>) -> Json<Vec<Charge>> {
    Json(state.read().await.charges.clone())
}

async fn meetings(State(state): State<AppState>) -> Json<Vec<Meeting>> {
    Json(state.read().await.meetings.clone())
}

#[tokio::main]
async fn main() {
    let path = PathBuf::from(std::env::var("SETUP_FILE").unwrap_or_else(|_| "setup.json".into()));
    let setup = setup::load(&path).unwrap_or_else(|e| {
        eprintln!("cannot load the church setup: {e}\nSet SETUP_FILE, or start from examples/setup.json.");
        std::process::exit(1);
    });
    let store = Store { church: setup.church, catalog: setup.catalog, charges: setup.charges, meetings: Vec::new() };

    let addr = std::env::var("API_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind API_ADDR");
    println!("api listening on http://{addr}");
    axum::serve(listener, app(Arc::new(RwLock::new(store)))).await.expect("server");
}
