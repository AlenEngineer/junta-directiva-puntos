//! Who is asking. A cookie names a session this server keeps, and the
//! session names the person WorkOS signed in. What they may do is read
//! again from the setup on every request (`domain::access`).

mod sign_in;
mod workos;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{extract::FromRequestParts, http::request::Parts};
use domain::{
    Date,
    access::Viewer,
    agenda::AgendaError,
    setup::{Setup, SetupError},
};

use crate::store::{RecordError, Store};

pub use sign_in::routes as sign_in_routes;

/// Where WorkOS's API lives. Tests pass a stand-in's address instead.
pub const WORKOS_API: &str = "https://api.workos.com";

/// What signing in needs from the deploy. `main` reads it from the
/// environment and does not start without the two WorkOS settings.
pub struct Config {
    /// `WORKOS_API`, or a stand-in's address in tests.
    pub workos_api: String,
    pub workos_client_id: String,
    pub workos_api_key: String,
    /// `MAYORDOMO_DEVELOPER_EMAIL`. Signed in like anyone else, may do everything.
    pub developer: Option<String>,
}

/// The router's state.
pub struct App {
    pub(crate) store: Store,
    workos: workos::Workos,
    developer: Option<String>,
    clock: Clock,
}

pub type AppState = Arc<App>;

impl App {
    pub fn new(store: Store, config: Config, clock: Clock) -> Self {
        let workos = workos::Workos::new(&config.workos_api, config.workos_client_id, config.workos_api_key);
        Self { store, workos, developer: config.developer, clock }
    }

    /// The church's setup, replayed from its history.
    pub(crate) async fn setup(&self) -> Result<Setup, ApiError> {
        self.store.setup().await?.ok_or(ApiError::Setup(SetupError::NoSetup))
    }
}

/// Anyone signed in: who they are and what they may do. Extracting it
/// answers 401 without a live session.
pub struct Me(pub Viewer);

impl FromRequestParts<AppState> for Me {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, ApiError> {
        let now = app.clock.now();
        let token = sign_in::session_token(&parts.headers).ok_or(ApiError::SignedOut)?;
        let person = app.store.signed_in(token, now.unix).await?.ok_or(ApiError::SignedOut)?;
        let setup = app.setup().await?;
        Ok(Self(Viewer::new(&setup, person, now.today, app.developer.as_deref())))
    }
}

/// Where the time comes from: the system clock in production, and a fixed
/// moment in tests, so the terms a test elects do not end under it.
pub struct Clock(Box<dyn Fn() -> i64 + Send + Sync>);

impl Clock {
    pub fn system() -> Self {
        Self(Box::new(|| SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)))
    }

    #[cfg(test)]
    pub fn fixed(unix: i64) -> Self {
        Self(Box::new(move || unix))
    }

    fn now(&self) -> Now {
        let unix = (self.0)();
        Now { unix, today: Date::from_unix_seconds(unix) }
    }
}

/// The moment a request is served: Unix seconds for sessions, and the UTC
/// day for the church year.
struct Now {
    unix: i64,
    today: Date,
}

/// Why a request got something other than what it asked for. `api.rs`
/// maps each to a status and `{"error": …}`.
pub enum ApiError {
    SignedOut,
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

#[cfg(test)]
mod tests {
    use axum::http::{Method, StatusCode};
    use serde_json::json;

    use crate::testing::{Cookie, DEVELOPER, TestApp, vote};

    #[tokio::test]
    async fn signed_out_nobody_is_known() {
        let app = TestApp::seeded().await;
        let (status, body) = app.call(&Cookie::none(), Method::GET, "/api/me", None).await;
        assert_eq!((status, body), (StatusCode::UNAUTHORIZED, json!({ "error": "sign in first" })));
    }

    #[tokio::test]
    async fn me_shows_who_signed_in_the_charges_that_serve_and_what_they_allow() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let ana = json!({ "office": "secretario", "holder": { "name": "Ana Rojas", "email": "Ana@Example.org" }, "term": { "start_year": 2026 } });
        let elected = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "business_meeting", json!({ "elect": [ana] }))).await;
        assert_eq!(elected.0, StatusCode::CREATED);

        let (status, me) = app.call(&app.sign_in("ana@example.org").await, Method::GET, "/api/me", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!((me["email"].as_str(), me["name"].as_str()), (Some("ana@example.org"), Some("ana Prueba")));
        assert_eq!((me["charges"][0]["id"].as_i64(), me["charges"][0]["office"].as_str()), (Some(2), Some("secretario")));
        assert_eq!(me["charges"].as_array().map(Vec::len), Some(1));
        assert_eq!(me["may"], json!({ "read_setup": true, "record_votes": true, "read_board": true, "run_board": false }));

        let (_, developer) = app.call(&dev, Method::GET, "/api/me", None).await;
        assert_eq!((&developer["charges"], &developer["may"]["run_board"]), (&json!([]), &json!(true)));
        let (_, nobody) = app.call(&app.sign_in("nadie@example.org").await, Method::GET, "/api/me", None).await;
        assert_eq!(nobody["charges"], json!([]));
        assert_eq!(nobody["may"], json!({ "read_setup": false, "record_votes": false, "read_board": false, "run_board": false }));
    }

    #[tokio::test]
    async fn before_the_church_has_a_setup_nobody_can_be_told_what_they_may_do() {
        let app = TestApp::unseeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        assert_eq!(app.call(&dev, Method::GET, "/api/me", None).await.0, StatusCode::SERVICE_UNAVAILABLE);
    }
}
