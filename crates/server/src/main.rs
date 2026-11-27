use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};
use domain::{
    Duty, DutyId, Module, Term,
    agenda::{AgendaItem, ItemKind, ItemStatus, Meeting, MeetingId, MeetingState},
};
use tokio::sync::RwLock;

/// In-memory until the persistence choice is made.
#[derive(Default)]
struct Store {
    duties: Vec<Duty>,
    meetings: Vec<Meeting>,
}

type AppState = Arc<RwLock<Store>>;

fn sample() -> Store {
    let elder = DutyId(1);
    Store {
        duties: vec![Duty {
            id: elder,
            title: "First elder".into(),
            term: Term { year: 2026 },
            modules: vec![Module::Agenda],
        }],
        meetings: vec![Meeting {
            id: MeetingId(1),
            duty: elder,
            title: "Church board".into(),
            date: "2026-12-06".into(),
            state: MeetingState::Draft,
            items: vec![AgendaItem {
                title: "Devotional".into(),
                kind: ItemKind::Informative,
                status: ItemStatus::Approved,
                presenter: None,
            }],
        }],
    }
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/duties", get(duties))
        .route("/api/meetings", get(meetings))
        .with_state(state)
}

async fn duties(State(state): State<AppState>) -> Json<Vec<Duty>> {
    Json(state.read().await.duties.clone())
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
