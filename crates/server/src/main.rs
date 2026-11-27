use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};
use domain::{
    Charge, ChargeId, Term,
    agenda::{AgendaItem, ItemKind, ItemStatus, Meeting, MeetingId, MeetingKind, MeetingState, SectionId},
    catalog::{Catalog, OfficeId},
};
use tokio::sync::RwLock;

/// In-memory until the persistence choice is made.
struct Store {
    catalog: Catalog,
    charges: Vec<Charge>,
    meetings: Vec<Meeting>,
}

type AppState = Arc<RwLock<Store>>;

fn sample() -> Store {
    let catalog = Catalog::manual_2025();
    let elder = ChargeId(1);
    let charge = Charge::from_catalog(&catalog, elder, &OfficeId::from("primer-anciano"), Term::one_year(2026))
        .expect("first elder is in the catalog");
    let meeting = Meeting {
        id: MeetingId(1),
        charge: elder,
        date: "2026-12-06".into(),
        kind: MeetingKind::Regular,
        state: MeetingState::Draft,
        sections: catalog.board_agenda.clone(),
        items: vec![AgendaItem {
            section: SectionId("finanzas".into()),
            title: "Informe de tesorería de noviembre".into(),
            kind: ItemKind::Informative,
            status: ItemStatus::Proposed,
            presenter: None,
        }],
    };
    Store { catalog, charges: vec![charge], meetings: vec![meeting] }
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/catalog", get(catalog))
        .route("/api/charges", get(charges))
        .route("/api/meetings", get(meetings))
        .with_state(state)
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
    let addr = std::env::var("API_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind API_ADDR");
    println!("api listening on http://{addr}");
    axum::serve(listener, app(Arc::new(RwLock::new(sample()))))
        .await
        .expect("server");
}
