use std::sync::Arc;

use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
};
use domain::{
    ChargeId,
    access::{Invitation, Viewer},
    agenda::{AgendaError, ItemId, Meeting, MeetingId, NewItem, NewMeeting},
    catalog::Catalog,
    setup::{Change, Entry, NewEntry, SetupError},
};
use serde_json::json;

use crate::access::{self, ApiError, App, Can, FirstSetup, Me, ReadBoard, ReadSetup, RecordVotes, RunBoard, WorkosError};

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::SignedOut => (StatusCode::UNAUTHORIZED, "sign in first".to_owned()),
            Self::Forbidden(needs) => (StatusCode::FORBIDDEN, needs.to_owned()),
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".to_owned()),
            Self::Conflict => (StatusCode::CONFLICT, "the meeting changed; reload and try again".to_owned()),
            Self::Agenda(e @ (AgendaError::AgendaClosed | AgendaError::AlreadyHeld)) => (StatusCode::CONFLICT, e.to_string()),
            Self::Agenda(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
            Self::Setup(e @ SetupError::NoSetup) => (StatusCode::SERVICE_UNAVAILABLE, e.to_string()),
            Self::Setup(e @ SetupError::Stale) => (StatusCode::CONFLICT, e.to_string()),
            Self::Setup(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
            Self::NoEmail(charge) => (StatusCode::UNPROCESSABLE_ENTITY, format!("charge {} has no email to invite", charge.0)),
            Self::Workos(WorkosError::Refused(message)) => (StatusCode::CONFLICT, message),
            Self::Workos(e) => {
                eprintln!("{e}");
                (StatusCode::BAD_GATEWAY, "WorkOS did not answer; try again".to_owned())
            }
            Self::Store(e) => {
                eprintln!("store error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "storage error".to_owned())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

/// Every route. A handler takes `Me` or a `Can<…>` first, so a caller who
/// may not pass gets 401 or 403 before any path or body is read. Nothing
/// in this file can reach the store any other way.
pub fn router(app: App) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .merge(access::sign_in_routes())
        .route("/api/me", get(me))
        .route("/api/setup", get(setup))
        .route("/api/setup/initial", get(manual).post(start_setup))
        .route("/api/setup/history", get(history).post(record_vote))
        .route("/api/setup/charges/{id}/invitation", post(invite))
        .route("/api/meetings", get(meetings).post(create_meeting))
        .route("/api/meetings/{id}", get(meeting))
        .route("/api/meetings/{id}/advance", post(advance))
        .route("/api/meetings/{id}/items", post(add_item))
        .route("/api/meetings/{id}/items/{item}", delete(remove_item))
        // Otherwise main's page fallback would answer a mistyped API path with the page.
        .route("/api/{*rest}", any(|| async { ApiError::NotFound }))
        .with_state(Arc::new(app))
}

async fn me(Me(viewer): Me) -> Json<Viewer> {
    Json(viewer)
}

async fn setup(can: Can<ReadSetup>) -> Response {
    Json(can.setup()).into_response()
}

async fn manual(first: FirstSetup) -> Json<Catalog> {
    Json(first.manual())
}

async fn start_setup(first: FirstSetup, Json(initial): Json<Change>) -> Result<(StatusCode, Json<Entry>), ApiError> {
    Ok((StatusCode::CREATED, Json(first.start(&initial).await?)))
}

async fn history(can: Can<ReadSetup>) -> ApiResult<Vec<Entry>> {
    Ok(Json(can.history().await?))
}

async fn record_vote(can: Can<RecordVotes>, Json(new): Json<NewEntry>) -> Result<(StatusCode, Json<Entry>), ApiError> {
    Ok((StatusCode::CREATED, Json(can.record(&new).await?)))
}

async fn invite(can: Can<RecordVotes>, Path(id): Path<u32>) -> Result<(StatusCode, Json<Invitation>), ApiError> {
    Ok((StatusCode::ACCEPTED, Json(can.invite(ChargeId(id)).await?)))
}

async fn meetings(can: Can<ReadBoard>) -> ApiResult<Vec<Meeting>> {
    Ok(Json(can.meetings().await?))
}

async fn meeting(can: Can<ReadBoard>, Path(id): Path<i64>) -> ApiResult<Meeting> {
    Ok(Json(can.meeting(MeetingId(id)).await?))
}

async fn create_meeting(can: Can<RunBoard>, Json(new): Json<NewMeeting>) -> Result<(StatusCode, Json<Meeting>), ApiError> {
    Ok((StatusCode::CREATED, Json(can.create_meeting(&new).await?)))
}

async fn advance(can: Can<RunBoard>, Path(id): Path<i64>) -> ApiResult<Meeting> {
    Ok(Json(can.advance(MeetingId(id)).await?))
}

async fn add_item(can: Can<RunBoard>, Path(id): Path<i64>, Json(item): Json<NewItem>) -> Result<(StatusCode, Json<Meeting>), ApiError> {
    Ok((StatusCode::CREATED, Json(can.add_item(MeetingId(id), &item).await?)))
}

async fn remove_item(can: Can<RunBoard>, Path((id, item)): Path<(i64, i64)>) -> ApiResult<Meeting> {
    Ok(Json(can.remove_item(MeetingId(id), ItemId(item)).await?))
}

#[cfg(test)]
mod tests {
    use axum::http::Method;
    use serde_json::Value;

    use super::*;
    use crate::store::{Store, tests::TempDatabase};
    use crate::testing::{DEVELOPER, TestApp, vote};

    fn item(section: &str, title: &str) -> Option<Value> {
        Some(json!({ "section": section, "office": "tesorero", "title": title, "presenter": null, "request": "accept_report",
                     "explanation": "", "received_on": null, "scans": [], "activity": null }))
    }

    fn ids(setup: &Value, list: &str) -> Vec<String> {
        setup["catalog"][list].as_array().unwrap().iter().map(|o| o["id"].as_str().unwrap().to_owned()).collect()
    }

    #[tokio::test]
    async fn a_board_meeting_is_prepared_called_and_held() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let (status, meeting) = app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(meeting["state"], "draft");
        assert_eq!(meeting["sections"][0]["id"], "devocional", "sections come from the catalog");

        let (status, meeting) = app.call(&dev, Method::POST, "/api/meetings/1/items", item("finanzas", "Informe de noviembre")).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!((&meeting["items"][0]["request"], &meeting["items"][0]["office"]), (&json!("accept_report"), &json!("tesorero")));

        let (_, meeting) = app.call(&dev, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(meeting["state"], "called");
        let (status, body) = app.call(&dev, Method::POST, "/api/meetings/1/items", item("finanzas", "Tarde")).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        let (status, _) = app.call(&dev, Method::DELETE, "/api/meetings/1/items/1", None).await;
        assert_eq!(status, StatusCode::CONFLICT, "a called agenda keeps its items");

        let (_, meeting) = app.call(&dev, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(meeting["state"], "held");
        let (status, _) = app.call(&dev, Method::POST, "/api/meetings/1/advance", None).await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn bad_input_is_rejected_with_a_reason() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let (status, body) = app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "06/12/2026", "kind": "regular" }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(body["error"].as_str().unwrap().contains("06/12/2026"));

        app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        let (status, _) = app.call(&dev, Method::POST, "/api/meetings/1/items", item("no-existe", "X")).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let mut with_a_scan = item("finanzas", "X").unwrap();
        with_a_scan["scans"] = json!([1]);
        let (status, body) = app.call(&dev, Method::POST, "/api/meetings/1/items", Some(with_a_scan)).await;
        assert_eq!((status, body["error"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("there is no scan 1")));
        let (status, _) = app.call(&dev, Method::POST, "/api/meetings/9/items", item("finanzas", "X")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _) = app.call(&dev, Method::DELETE, "/api/meetings/1/items/9", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn meetings_survive_a_restart() {
        let database = TempDatabase::new("meetings-restart");
        {
            let app = TestApp::open(&database.url()).await;
            let dev = app.sign_in(DEVELOPER).await;
            app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "evangelism" }))).await;
            app.call(&dev, Method::POST, "/api/meetings/1/items", item("evangelismo", "Campaña de primavera")).await;
        }
        let app = TestApp::open(&database.url()).await;
        let dev = app.sign_in(DEVELOPER).await;
        let (_, meetings) = app.call(&dev, Method::GET, "/api/meetings", None).await;
        assert_eq!(meetings[0]["kind"], "evangelism");
        assert_eq!(meetings[0]["items"][0]["title"], "Campaña de primavera");
    }

    #[tokio::test]
    async fn the_developer_enters_the_first_setup_once_and_votes_survive_a_restart() {
        let database = TempDatabase::new("setup-restart");
        let initial = json!({
            "church": "Iglesia de Panamá", "year_starts": 10, "catalog": { "hide": ["hogar-y-escuela"] },
            "elect": [{ "office": "secretario", "holder": { "name": "Ana Rojas", "email": "Ana@Example.org" }, "term": { "start_year": 2026 } }],
        });
        {
            let app = TestApp::serving(Store::open(&database.url()).await.unwrap()).await;
            let ana = app.sign_in("ana@example.org").await;
            let (status, body) = app.call(&ana, Method::POST, "/api/setup/initial", Some(initial.clone())).await;
            assert_eq!((status, body["error"].as_str()), (StatusCode::FORBIDDEN, Some("only the developer enters the church's first setup")));
            let dev = app.sign_in(DEVELOPER).await;
            let (status, manual) = app.call(&dev, Method::GET, "/api/setup/initial", None).await;
            assert_eq!((status, manual["offices"].as_array().map(Vec::len)), (StatusCode::OK, Some(32)), "the manual's offices to start from");
            let (status, body) = app.call(&dev, Method::POST, "/api/setup/initial", Some(json!({ "church": " " }))).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
            let (status, entry) = app.call(&dev, Method::POST, "/api/setup/initial", Some(initial.clone())).await;
            assert_eq!((status, &entry["id"], &entry["approval"]), (StatusCode::CREATED, &json!(1), &json!({ "kind": "initial" })));
            assert_eq!(app.call(&dev, Method::POST, "/api/setup/initial", Some(initial.clone())).await.0, StatusCode::CONFLICT);
            assert_eq!(app.call(&dev, Method::GET, "/api/setup/initial", None).await.0, StatusCode::CONFLICT);

            let (_, me) = app.call(&ana, Method::GET, "/api/me", None).await;
            assert_eq!(
                (&me["desks"][0]["charge"]["office"], &me["may"]["record_votes"]),
                (&json!("secretario"), &json!(true)),
                "the same session, now the clerk"
            );
            let rename = vote(1, "church", json!({ "church": "Iglesia Central" }));
            assert_eq!(app.call(&ana, Method::POST, "/api/setup/history", rename).await.0, StatusCode::CREATED);
        }
        let app = TestApp::open(&database.url()).await;
        let dev = app.sign_in(DEVELOPER).await;
        let (_, setup) = app.call(&dev, Method::GET, "/api/setup", None).await;
        assert_eq!(
            (setup["church"].as_str(), setup["latest"].as_i64(), setup["year_starts"].as_i64()),
            (Some("Iglesia Central"), Some(2), Some(10))
        );
        assert_eq!((&setup["church_year"], &setup["serving"]), (&json!(2026), &json!([1])), "December 2026 is in church year 2026");
        assert!(setup["catalog"]["hidden"].as_array().unwrap().iter().any(|o| o["id"] == "hogar-y-escuela"));
        let (_, history) = app.call(&dev, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history[1]["approval"], json!({ "kind": "vote", "body": "church", "date": "2026-03-07", "minute": "Acta 3/2026" }));
    }

    #[tokio::test]
    async fn one_vote_adds_an_office_and_elects_its_holder() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let change = json!({
            "catalog": { "offices": [{ "id": "bienvenida", "name": "Coordinador de bienvenida", "board_member": false,
                                       "responsibilities": [{ "summary": "Recibir a las visitas" }] }] },
            "elect": [{ "office": "bienvenida", "holder": { "name": "Carlos Díaz", "email": "Carlos@Example.org" },
                        "term": { "start_year": 2026 } }]
        });
        let (status, entry) = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "church", change)).await;
        assert_eq!(status, StatusCode::CREATED, "{entry}");
        assert_eq!(entry["id"], 2);

        let (_, setup) = app.call(&dev, Method::GET, "/api/setup", None).await;
        assert_eq!(setup["latest"], 2);
        let offices = setup["catalog"]["offices"].as_array().unwrap();
        let office = offices.iter().find(|o| o["id"] == "bienvenida").expect("the vote added it");
        assert_eq!(office["approved_by"], "Voto de la iglesia, 2026-03-07, Acta 3/2026");
        let charge = &setup["charges"][1];
        assert_eq!((charge["id"].as_i64(), charge["office"].as_str()), (Some(2), Some("bienvenida")));
        assert_eq!(charge["holder"], json!({ "name": "Carlos Díaz", "email": "carlos@example.org" }));
        assert_eq!(charge["responsibilities"][0]["summary"], "Recibir a las visitas");
    }

    #[tokio::test]
    async fn the_board_may_not_elect_and_new_meetings_use_its_agenda() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "2026-12-06", "kind": "regular" }))).await;
        let election = json!({ "elect": [{ "office": "secretario", "holder": { "name": "Ana Rojas" }, "term": { "start_year": 2026 } }] });
        let (status, body) = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "board", election)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "the board can only change the board agenda, the places and the service schedule; this change needs a vote of the church");

        let agenda = json!({ "catalog": { "board_agenda": [{ "id": "oracion", "title": "Oración" }] } });
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", vote(1, "board", agenda)).await.0, StatusCode::CREATED);
        let (_, meeting) = app.call(&dev, Method::POST, "/api/meetings", Some(json!({ "date": "2027-01-10", "kind": "regular" }))).await;
        assert_eq!(meeting["sections"], json!([{ "id": "oracion", "title": "Oración", "page": null }]));
        let (_, first) = app.call(&dev, Method::GET, "/api/meetings/1", None).await;
        assert_eq!(first["sections"][0]["id"], "devocional", "a meeting keeps the agenda it was created with");
    }

    #[tokio::test]
    async fn the_church_moves_the_start_of_the_church_year() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        assert_eq!(app.call(&dev, Method::GET, "/api/setup", None).await.1["year_starts"], 1);
        let october = vote(1, "church", json!({ "year_starts": 10 }));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", october).await.0, StatusCode::CREATED);
        assert_eq!(app.call(&dev, Method::GET, "/api/setup", None).await.1["year_starts"], 10);
        let thirteenth = vote(2, "church", json!({ "year_starts": 13 }));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", thirteenth).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn a_hidden_office_is_restored_by_a_later_vote() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let hide = json!({ "catalog": { "hide": ["club-de-aventureros"] } });
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", vote(1, "church", hide)).await.0, StatusCode::CREATED);
        let (_, setup) = app.call(&dev, Method::GET, "/api/setup", None).await;
        assert!(!ids(&setup, "offices").contains(&"club-de-aventureros".to_owned()));
        assert!(ids(&setup, "hidden").contains(&"club-de-aventureros".to_owned()));

        let restore = json!({ "catalog": { "restore": ["club-de-aventureros"] } });
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", vote(2, "church", restore)).await.0, StatusCode::CREATED);
        let (_, setup) = app.call(&dev, Method::GET, "/api/setup", None).await;
        assert!(ids(&setup, "offices").contains(&"club-de-aventureros".to_owned()));
        assert!(!ids(&setup, "hidden").contains(&"club-de-aventureros".to_owned()));
    }

    #[tokio::test]
    async fn an_invalid_change_is_refused_with_its_reason_and_nothing_is_recorded() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        for (change, reason) in [
            (json!({ "catalog": { "hide": ["club-de-aventurero"] } }), "Iglesia de ejemplo: cannot hide unknown office club-de-aventurero"),
            (json!({ "catalog": { "hide": ["anciano"] } }), "primer-anciano is a variant of unknown anciano"),
            (
                json!({ "catalog": { "restore": ["club-de-aventureros"] } }),
                "Iglesia de ejemplo: cannot restore office club-de-aventureros, which is not hidden",
            ),
            (json!({}), "a vote has to change something"),
        ] {
            let (status, body) = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "church", change)).await;
            assert_eq!((status, body["error"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some(reason)));
        }
        let (_, history) = app.call(&dev, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history.as_array().map(Vec::len), Some(1));
    }

    #[tokio::test]
    async fn a_stale_vote_is_refused_and_nothing_is_recorded() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let rename = vote(1, "church", json!({ "church": "Iglesia Central" }));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", rename.clone()).await.0, StatusCode::CREATED);
        for stale in [rename, vote(5, "church", json!({ "church": "Iglesia Norte" }))] {
            let (status, body) = app.call(&dev, Method::POST, "/api/setup/history", stale).await;
            assert_eq!((status, body["error"].as_str()), (StatusCode::CONFLICT, Some("the church setup changed; reload and try again")));
        }
        let (_, history) = app.call(&dev, Method::GET, "/api/setup/history", None).await;
        assert_eq!(history.as_array().map(Vec::len), Some(2));
        let (_, setup) = app.call(&dev, Method::GET, "/api/setup", None).await;
        assert_eq!(setup["church"], "Iglesia Central");
    }

    #[tokio::test]
    async fn a_database_never_seeded_has_no_setup_to_serve() {
        let app = TestApp::unseeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        assert_eq!(app.call(&dev, Method::GET, "/api/setup", None).await.0, StatusCode::SERVICE_UNAVAILABLE);
        let rename = vote(0, "church", json!({ "church": "Iglesia" }));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", rename).await.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(app.call(&dev, Method::GET, "/api/setup/history", None).await.0, StatusCode::SERVICE_UNAVAILABLE);
    }
}
