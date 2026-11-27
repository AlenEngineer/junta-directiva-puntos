use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use domain::{
    Charge,
    agenda::{AgendaError, ItemId, ItemStatus, Meeting, MeetingId, NewItem, NewMeeting},
    catalog::Catalog,
};
use serde::Deserialize;
use serde_json::json;

use crate::store::Store;

pub struct App {
    pub church: String,
    pub catalog: Catalog,
    pub charges: Vec<Charge>,
    pub store: Store,
}

type AppState = Arc<App>;

pub enum ApiError {
    NotFound,
    /// Another request changed the meeting first.
    Conflict,
    Agenda(AgendaError),
    Store(sqlx::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Store(e)
    }
}

impl From<AgendaError> for ApiError {
    fn from(e: AgendaError) -> Self {
        Self::Agenda(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".to_owned()),
            Self::Conflict => (StatusCode::CONFLICT, "the meeting changed; reload and try again".to_owned()),
            Self::Agenda(e @ (AgendaError::AgendaClosed | AgendaError::AlreadyHeld)) => (StatusCode::CONFLICT, e.to_string()),
            Self::Agenda(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
            Self::Store(e) => {
                eprintln!("store error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "storage error".to_owned())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

pub fn router(app: App) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/church", get(church))
        .route("/api/catalog", get(catalog))
        .route("/api/charges", get(charges))
        .route("/api/meetings", get(meetings).post(create_meeting))
        .route("/api/meetings/{id}", get(meeting))
        .route("/api/meetings/{id}/advance", post(advance))
        .route("/api/meetings/{id}/items", post(add_item))
        .route("/api/meetings/{id}/items/{item}", axum::routing::delete(remove_item))
        .route("/api/meetings/{id}/items/{item}/status", put(set_item_status))
        .with_state(Arc::new(app))
}

async fn church(State(app): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "name": app.church }))
}

async fn catalog(State(app): State<AppState>) -> Json<Catalog> {
    Json(app.catalog.clone())
}

async fn charges(State(app): State<AppState>) -> Json<Vec<Charge>> {
    Json(app.charges.clone())
}

async fn meetings(State(app): State<AppState>) -> ApiResult<Vec<Meeting>> {
    Ok(Json(app.store.meetings().await?))
}

async fn load(app: &App, id: i64) -> Result<Meeting, ApiError> {
    app.store.meeting(MeetingId(id)).await?.ok_or(ApiError::NotFound)
}

async fn meeting(State(app): State<AppState>, Path(id): Path<i64>) -> ApiResult<Meeting> {
    Ok(Json(load(&app, id).await?))
}

async fn create_meeting(State(app): State<AppState>, Json(new): Json<NewMeeting>) -> Result<(StatusCode, Json<Meeting>), ApiError> {
    new.validate()?;
    let id = app.store.create_meeting(&new, &app.catalog.board_agenda).await?;
    Ok((StatusCode::CREATED, Json(load(&app, id.0).await?)))
}

async fn advance(State(app): State<AppState>, Path(id): Path<i64>) -> ApiResult<Meeting> {
    let meeting = load(&app, id).await?;
    let next = meeting.next_state()?;
    if !app.store.set_state(meeting.id, meeting.state, next).await? {
        return Err(ApiError::Conflict);
    }
    Ok(Json(load(&app, id).await?))
}

async fn add_item(State(app): State<AppState>, Path(id): Path<i64>, Json(item): Json<NewItem>) -> Result<(StatusCode, Json<Meeting>), ApiError> {
    let meeting = load(&app, id).await?;
    meeting.check_new_item(&item)?;
    app.store.add_item(meeting.id, &item).await?.ok_or(ApiError::Agenda(AgendaError::AgendaClosed))?;
    Ok((StatusCode::CREATED, Json(load(&app, id).await?)))
}

#[derive(Deserialize)]
struct StatusBody {
    status: ItemStatus,
}

async fn set_item_status(
    State(app): State<AppState>,
    Path((id, item)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> ApiResult<Meeting> {
    if !app.store.set_item_status(MeetingId(id), ItemId(item), body.status).await? {
        return Err(ApiError::NotFound);
    }
    Ok(Json(load(&app, id).await?))
}

async fn remove_item(State(app): State<AppState>, Path((id, item)): Path<(i64, i64)>) -> ApiResult<Meeting> {
    let meeting = load(&app, id).await?;
    if !meeting.items.iter().any(|i| i.id.0 == item) {
        return Err(ApiError::NotFound);
    }
    if !app.store.remove_item(meeting.id, ItemId(item)).await? {
        return Err(ApiError::Agenda(AgendaError::AgendaClosed));
    }
    Ok(Json(load(&app, id).await?))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Method, Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;

    async fn app_with(database: &str) -> Router {
        let setup = crate::setup::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/setup.json")).unwrap();
        let store = Store::open(database).await.unwrap();
        router(App { church: setup.church, catalog: setup.catalog, charges: setup.charges, store })
    }

    async fn call(app: &Router, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    fn item(section: &str, title: &str) -> Option<Value> {
        Some(json!({ "section": section, "title": title, "kind": "informative", "presenter": null }))
    }

    #[tokio::test]
    async fn a_board_meeting_is_prepared_called_and_held() {
        let app = app_with("sqlite::memory:").await;
        let (status, meeting) = call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(meeting["state"], "draft");
        assert_eq!(meeting["sections"][0]["id"], "devocional", "sections come from the catalog");

        let (status, meeting) = call(&app, Method::POST, "/api/meetings/1/items", item("finanzas", "Informe de noviembre")).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(meeting["items"][0]["status"], "proposed");

        let (_, meeting) = call(&app, Method::PUT, "/api/meetings/1/items/1/status", Some(json!({ "status": "approved" }))).await;
        assert_eq!(meeting["items"][0]["status"], "approved");

        let (_, meeting) = call(&app, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(meeting["state"], "called");
        let (status, body) = call(&app, Method::POST, "/api/meetings/1/items", item("finanzas", "Tarde")).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        let (status, _) = call(&app, Method::DELETE, "/api/meetings/1/items/1", None).await;
        assert_eq!(status, StatusCode::CONFLICT, "a called agenda keeps its items");

        let (_, meeting) = call(&app, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(meeting["state"], "held");
        let (status, _) = call(&app, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn bad_input_is_rejected_with_a_reason() {
        let app = app_with("sqlite::memory:").await;
        let (status, body) = call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "06/12/2026", "kind": "regular" }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(body["error"].as_str().unwrap().contains("06/12/2026"));

        call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        let (status, _) = call(&app, Method::POST, "/api/meetings/1/items", item("no-existe", "X")).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let (status, _) = call(&app, Method::POST, "/api/meetings/9/items", item("finanzas", "X")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _) = call(&app, Method::DELETE, "/api/meetings/1/items/9", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn meetings_survive_a_restart() {
        let path = std::env::temp_dir().join(format!("mayordomo-test-{}.db", std::process::id()));
        let url = format!("sqlite://{}", path.display());
        {
            let app = app_with(&url).await;
            call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "evangelism" }))).await;
            call(&app, Method::POST, "/api/meetings/1/items", item("evangelismo", "Campaña de primavera")).await;
        }
        let app = app_with(&url).await;
        let (_, meetings) = call(&app, Method::GET, "/api/meetings", None).await;
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        assert_eq!(meetings[0]["kind"], "evangelism");
        assert_eq!(meetings[0]["items"][0]["title"], "Campaña de primavera");
    }
}
