use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use domain::{
    agenda::{AgendaError, ItemId, ItemStatus, Meeting, MeetingId, NewItem, NewMeeting},
    setup::{Entry, NewEntry, Setup, SetupError},
};
use serde::Deserialize;
use serde_json::json;

use crate::store::{RecordError, Store};

/// Holds no copy of the church's setup, so each request replays the latest votes.
pub struct App {
    pub store: Store,
}

impl App {
    async fn setup(&self) -> Result<Setup, ApiError> {
        self.store.setup().await?.ok_or(ApiError::Setup(SetupError::NoSetup))
    }
}

type AppState = Arc<App>;

pub enum ApiError {
    NotFound,
    /// Another request changed the meeting first.
    Conflict,
    Agenda(AgendaError),
    Setup(SetupError),
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

impl From<RecordError> for ApiError {
    fn from(e: RecordError) -> Self {
        match e {
            RecordError::Rejected(e) => Self::Setup(e),
            RecordError::Storage(e) => Self::Store(e),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".to_owned()),
            Self::Conflict => (StatusCode::CONFLICT, "the meeting changed; reload and try again".to_owned()),
            Self::Agenda(e @ (AgendaError::AgendaClosed | AgendaError::AlreadyHeld)) => (StatusCode::CONFLICT, e.to_string()),
            Self::Agenda(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
            Self::Setup(e @ SetupError::NoSetup) => (StatusCode::SERVICE_UNAVAILABLE, e.to_string()),
            Self::Setup(e @ SetupError::Stale) => (StatusCode::CONFLICT, e.to_string()),
            Self::Setup(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
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
        .route("/api/setup", get(setup))
        .route("/api/setup/history", get(history).post(record_change))
        .route("/api/meetings", get(meetings).post(create_meeting))
        .route("/api/meetings/{id}", get(meeting))
        .route("/api/meetings/{id}/advance", post(advance))
        .route("/api/meetings/{id}/items", post(add_item))
        .route("/api/meetings/{id}/items/{item}", axum::routing::delete(remove_item))
        .route("/api/meetings/{id}/items/{item}/status", put(set_item_status))
        .with_state(Arc::new(app))
}

async fn setup(State(app): State<AppState>) -> ApiResult<Setup> {
    Ok(Json(app.setup().await?))
}

async fn history(State(app): State<AppState>) -> ApiResult<Vec<Entry>> {
    Ok(Json(app.store.history().await?))
}

async fn record_change(State(app): State<AppState>, Json(new): Json<NewEntry>) -> Result<(StatusCode, Json<Entry>), ApiError> {
    Ok((StatusCode::CREATED, Json(app.store.record(&new).await?)))
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
    let setup = app.setup().await?;
    let id = app.store.create_meeting(&new, &setup.catalog().board_agenda).await?;
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
    use crate::store::tests::TempDatabase;

    async fn seeded_from(database: &str, setup_file: &str) -> Router {
        let store = Store::open(database).await.unwrap();
        let examples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples");
        crate::seed::ensure(&store, &examples.join(setup_file)).await.unwrap();
        router(App { store })
    }

    async fn app_with(database: &str) -> Router {
        seeded_from(database, "setup.json").await
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

    fn vote(after: i64, body: &str, change: Value) -> Option<Value> {
        Some(json!({ "after": after, "vote": { "body": body, "date": "2026-03-07", "minute": "Acta 3/2026" }, "change": change }))
    }

    fn ids(setup: &Value, list: &str) -> Vec<String> {
        setup["catalog"][list].as_array().unwrap().iter().map(|o| o["id"].as_str().unwrap().to_owned()).collect()
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
        let database = TempDatabase::new("meetings-restart");
        {
            let app = app_with(&database.url()).await;
            call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "evangelism" }))).await;
            call(&app, Method::POST, "/api/meetings/1/items", item("evangelismo", "Campaña de primavera")).await;
        }
        let app = app_with(&database.url()).await;
        let (_, meetings) = call(&app, Method::GET, "/api/meetings", None).await;
        assert_eq!(meetings[0]["kind"], "evangelism");
        assert_eq!(meetings[0]["items"][0]["title"], "Campaña de primavera");
    }

    #[tokio::test]
    async fn the_setup_file_seeds_the_database_once_and_votes_survive_a_restart() {
        let database = TempDatabase::new("setup-restart");
        {
            let app = app_with(&database.url()).await;
            let (status, setup) = call(&app, Method::GET, "/api/setup", None).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!((setup["church"].as_str(), setup["latest"].as_i64()), (Some("Iglesia de ejemplo"), Some(1)));
            assert_eq!(setup["catalog"]["layers"].as_array().map(Vec::len), Some(2));
            assert_eq!(setup["charges"][0]["holder"]["name"], "Hermano de ejemplo");
            let rename = vote(1, "business_meeting", json!({ "church": "Iglesia Central" }));
            assert_eq!(call(&app, Method::POST, "/api/setup/history", rename).await.0, StatusCode::CREATED);
        }
        let app = seeded_from(&database.url(), "no-such-file.json").await;
        let (_, setup) = call(&app, Method::GET, "/api/setup", None).await;
        assert_eq!((setup["church"].as_str(), setup["latest"].as_i64()), (Some("Iglesia Central"), Some(2)));
        let (_, history) = call(&app, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history.as_array().map(Vec::len), Some(2));
        assert_eq!(history[0]["approval"], json!({ "kind": "initial" }));
        assert_eq!(history[1]["approval"], json!({ "kind": "vote", "body": "business_meeting", "date": "2026-03-07", "minute": "Acta 3/2026" }));
    }

    #[tokio::test]
    async fn one_vote_adds_an_office_and_elects_its_holder() {
        let app = app_with("sqlite::memory:").await;
        let change = json!({
            "catalog": { "offices": [{ "id": "bienvenida", "name": "Coordinador de bienvenida", "board_member": false,
                                       "responsibilities": [{ "summary": "Recibir a las visitas" }] }] },
            "elect": [{ "office": "bienvenida", "holder": { "name": "Carlos Díaz", "email": "Carlos@Example.org" },
                        "term": { "start_year": 2026 } }]
        });
        let (status, entry) = call(&app, Method::POST, "/api/setup/history", vote(1, "business_meeting", change)).await;
        assert_eq!(status, StatusCode::CREATED, "{entry}");
        assert_eq!(entry["id"], 2);

        let (_, setup) = call(&app, Method::GET, "/api/setup", None).await;
        assert_eq!(setup["latest"], 2);
        let offices = setup["catalog"]["offices"].as_array().unwrap();
        let office = offices.iter().find(|o| o["id"] == "bienvenida").expect("the vote added it");
        assert_eq!(office["approved_by"], "Reunión administrativa, 2026-03-07, Acta 3/2026");
        let charge = &setup["charges"][1];
        assert_eq!((charge["id"].as_i64(), charge["office"].as_str()), (Some(2), Some("bienvenida")));
        assert_eq!(charge["holder"], json!({ "name": "Carlos Díaz", "email": "carlos@example.org" }));
        assert_eq!(charge["responsibilities"][0]["summary"], "Recibir a las visitas");
    }

    #[tokio::test]
    async fn the_board_votes_only_its_agenda_and_new_meetings_use_it() {
        let app = app_with("sqlite::memory:").await;
        call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        let election = json!({ "elect": [{ "office": "secretario", "holder": { "name": "Ana Rojas" }, "term": { "start_year": 2026 } }] });
        let (status, body) = call(&app, Method::POST, "/api/setup/history", vote(1, "board", election)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "the board can only change the board agenda; this change needs a business meeting vote");

        let agenda = json!({ "catalog": { "board_agenda": [{ "id": "oracion", "title": "Oración" }] } });
        assert_eq!(call(&app, Method::POST, "/api/setup/history", vote(1, "board", agenda)).await.0, StatusCode::CREATED);
        let (_, meeting) = call(&app, Method::POST, "/api/meetings", Some(json!({ "date": "2027-01-10", "kind": "regular" }))).await;
        assert_eq!(meeting["sections"], json!([{ "id": "oracion", "title": "Oración", "page": null }]));
        let (_, first) = call(&app, Method::GET, "/api/meetings/1", None).await;
        assert_eq!(first["sections"][0]["id"], "devocional", "a meeting keeps the agenda it was created with");
    }

    #[tokio::test]
    async fn a_hidden_office_is_restored_by_a_later_vote() {
        let app = app_with("sqlite::memory:").await;
        let hide = json!({ "catalog": { "hide": ["club-de-aventureros"] } });
        assert_eq!(call(&app, Method::POST, "/api/setup/history", vote(1, "business_meeting", hide)).await.0, StatusCode::CREATED);
        let (_, setup) = call(&app, Method::GET, "/api/setup", None).await;
        assert!(!ids(&setup, "offices").contains(&"club-de-aventureros".to_owned()));
        assert!(ids(&setup, "hidden").contains(&"club-de-aventureros".to_owned()));

        let restore = json!({ "catalog": { "restore": ["club-de-aventureros"] } });
        assert_eq!(call(&app, Method::POST, "/api/setup/history", vote(2, "business_meeting", restore)).await.0, StatusCode::CREATED);
        let (_, setup) = call(&app, Method::GET, "/api/setup", None).await;
        assert!(ids(&setup, "offices").contains(&"club-de-aventureros".to_owned()));
        assert!(!ids(&setup, "hidden").contains(&"club-de-aventureros".to_owned()));
    }

    #[tokio::test]
    async fn an_invalid_change_is_refused_with_its_reason_and_nothing_is_recorded() {
        let app = app_with("sqlite::memory:").await;
        for (change, reason) in [
            (json!({ "catalog": { "hide": ["club-de-aventurero"] } }), "Iglesia de ejemplo: cannot hide unknown office club-de-aventurero"),
            (json!({ "catalog": { "hide": ["anciano"] } }), "primer-anciano is a variant of unknown anciano"),
            (
                json!({ "catalog": { "restore": ["club-de-aventureros"] } }),
                "Iglesia de ejemplo: cannot restore office club-de-aventureros, which is not hidden",
            ),
            (json!({}), "a vote has to change something"),
        ] {
            let (status, body) = call(&app, Method::POST, "/api/setup/history", vote(1, "business_meeting", change)).await;
            assert_eq!((status, body["error"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some(reason)));
        }
        let (_, history) = call(&app, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history.as_array().map(Vec::len), Some(1));
    }

    #[tokio::test]
    async fn a_stale_vote_is_refused_and_nothing_is_recorded() {
        let app = app_with("sqlite::memory:").await;
        let rename = vote(1, "business_meeting", json!({ "church": "Iglesia Central" }));
        assert_eq!(call(&app, Method::POST, "/api/setup/history", rename.clone()).await.0, StatusCode::CREATED);
        for stale in [rename, vote(5, "business_meeting", json!({ "church": "Iglesia Norte" }))] {
            let (status, body) = call(&app, Method::POST, "/api/setup/history", stale).await;
            assert_eq!((status, body["error"].as_str()), (StatusCode::CONFLICT, Some("the church setup changed; reload and try again")));
        }
        let (_, history) = call(&app, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history.as_array().map(Vec::len), Some(2));
        let (_, setup) = call(&app, Method::GET, "/api/setup", None).await;
        assert_eq!(setup["church"], "Iglesia Central");
    }

    #[tokio::test]
    async fn a_database_never_seeded_has_no_setup_to_serve() {
        let app = router(App { store: Store::open("sqlite::memory:").await.unwrap() });
        assert_eq!(call(&app, Method::GET, "/api/setup", None).await.0, StatusCode::SERVICE_UNAVAILABLE);
        let rename = vote(0, "business_meeting", json!({ "church": "Iglesia" }));
        assert_eq!(call(&app, Method::POST, "/api/setup/history", rename).await.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(call(&app, Method::GET, "/api/setup/history", None).await, (StatusCode::OK, json!([])));
    }
}
