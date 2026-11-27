//! The door to the church's data.
//!
//! A handler reaches the store only through `Me` or a `Can<P>`, and
//! extracting one is the check. Who is asking comes from the session
//! cookie. What they may do comes from the charges that serve today, read
//! again from the setup on every request. `App` keeps its parts private to
//! this module, and every operation on the church's data is a method of the
//! `Can<P>` whose permission it needs (`setup.rs`, `board.rs`). So no route
//! reaches the data without the check, or through a permission that does
//! not allow it.

mod board;
mod setup;
mod sign_in;
mod workos;

use std::marker::PhantomData;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{extract::FromRequestParts, http::request::Parts};
use domain::{
    ChargeId, Date,
    access::{May, Viewer},
    agenda::AgendaError,
    setup::{Setup, SetupError},
};

use crate::store::{RecordError, Store};

pub use sign_in::routes as sign_in_routes;
pub use workos::WorkosError;

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

/// The router's state. Its parts are private to this module: outside it,
/// nothing leads from an `App` to the store or to WorkOS.
pub struct App {
    store: Store,
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
}

/// Anyone signed in: who they are and what they may do, never the
/// church's data. Extracting it answers 401 without a live session.
pub struct Me(pub Viewer);

impl FromRequestParts<AppState> for Me {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, ApiError> {
        Ok(Self(signed(parts, app).await?.viewer))
    }
}

/// The developer, before the church has a setup: the one way to write
/// entry 1. Extracting it answers 401 without a live session, 409 once a
/// setup exists, and 403 for anyone else.
pub struct FirstSetup {
    app: AppState,
}

impl FromRequestParts<AppState> for FirstSetup {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, ApiError> {
        let Signed { viewer, setup } = signed(parts, app).await?;
        if setup.is_some() {
            return Err(ApiError::Setup(SetupError::Stale));
        }
        if !viewer.may.start_setup {
            return Err(ApiError::Forbidden("only the developer enters the church's first setup"));
        }
        Ok(Self { app: Arc::clone(app) })
    }
}

/// The person asking may do `P`. Every operation on the church's data is a
/// method of the `Can<P>` whose permission it needs, and only extraction
/// makes one, so holding a `Can<P>` proves the check passed.
pub struct Can<P> {
    app: AppState,
    /// The setup this request's permissions were read from. Operations
    /// reuse it, so a request replays the history once.
    setup: Setup,
    _may: PhantomData<fn() -> P>,
}

/// A group of routes, named for the `May` field that opens it.
pub trait Permission {
    /// What the 403 says is missing.
    const NEEDS: &'static str;
    fn granted(may: &May) -> bool;
}

/// `GET /api/setup`, `GET /api/setup/history`.
pub enum ReadSetup {}
/// `POST /api/setup/history`, `POST /api/setup/charges/{id}/invitation`.
pub enum RecordVotes {}
/// `GET /api/meetings`, `GET /api/meetings/{id}`.
pub enum ReadBoard {}
/// Every `/api/meetings` route that changes something.
pub enum RunBoard {}

impl Permission for ReadSetup {
    const NEEDS: &'static str = "seeing the church's setup needs a charge that serves today";
    fn granted(may: &May) -> bool {
        may.read_setup
    }
}

impl Permission for RecordVotes {
    const NEEDS: &'static str = "recording votes and inviting holders needs the clerk or the first elder";
    fn granted(may: &May) -> bool {
        may.record_votes
    }
}

impl Permission for ReadBoard {
    const NEEDS: &'static str = "the board's meetings are for its members";
    fn granted(may: &May) -> bool {
        may.read_board
    }
}

impl Permission for RunBoard {
    const NEEDS: &'static str = "running board meetings needs the charge that carries the agenda";
    fn granted(may: &May) -> bool {
        may.run_board
    }
}

impl<P: Permission> FromRequestParts<AppState> for Can<P> {
    type Rejection = ApiError;

    /// 401 without a live session, 503 before the church has a setup, and
    /// 403 when no charge that serves today grants `P`.
    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, ApiError> {
        let Signed { viewer, setup } = signed(parts, app).await?;
        let setup = setup.ok_or(ApiError::Setup(SetupError::NoSetup))?;
        if !P::granted(&viewer.may) {
            return Err(ApiError::Forbidden(P::NEEDS));
        }
        Ok(Self { app: Arc::clone(app), setup, _may: PhantomData })
    }
}

/// Who is asking, with the setup their permissions were read from, if
/// the church has one yet.
struct Signed {
    viewer: Viewer,
    setup: Option<Setup>,
}

/// Read once per request: the session cookie, the live session it names,
/// the setup replayed from its history, and today from the clock.
async fn signed(parts: &Parts, app: &App) -> Result<Signed, ApiError> {
    let now = app.clock.now();
    let token = sign_in::session_token(&parts.headers).ok_or(ApiError::SignedOut)?;
    let person = app.store.signed_in(token, now.unix).await?.ok_or(ApiError::SignedOut)?;
    let setup = app.store.setup().await?;
    let viewer = match &setup {
        Some(setup) => Viewer::new(setup, person, now.today, app.developer.as_deref()),
        None => Viewer::before_setup(person, app.developer.as_deref()),
    };
    Ok(Signed { viewer, setup })
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
    /// Signed in, but no charge that serves today allows this. Says what it needs.
    Forbidden(&'static str),
    NotFound,
    /// Another request changed the meeting first.
    Conflict,
    Agenda(AgendaError),
    Setup(SetupError),
    NoEmail(ChargeId),
    Workos(WorkosError),
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

    use crate::testing::{Cookie, DEVELOPER, Expect, TestApp, vote};

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
        let elected = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "church", json!({ "elect": [ana] }))).await;
        assert_eq!(elected.0, StatusCode::CREATED);

        let (status, me) = app.call(&app.sign_in("ana@example.org").await, Method::GET, "/api/me", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!((me["email"].as_str(), me["name"].as_str()), (Some("ana@example.org"), Some("ana Prueba")));
        assert_eq!((me["desks"][0]["charge"]["id"].as_i64(), me["desks"][0]["charge"]["office"].as_str()), (Some(2), Some("secretario")));
        assert_eq!(me["desks"].as_array().map(Vec::len), Some(1));
        assert_eq!(me["may"], json!({ "read_setup": true, "record_votes": true, "read_board": true, "run_board": false, "start_setup": false }));

        let (_, developer) = app.call(&dev, Method::GET, "/api/me", None).await;
        assert_eq!((&developer["desks"], &developer["may"]["run_board"]), (&json!([]), &json!(true)));
        let (_, nobody) = app.call(&app.sign_in("nadie@example.org").await, Method::GET, "/api/me", None).await;
        assert_eq!(nobody["desks"], json!([]));
        assert_eq!(
            nobody["may"],
            json!({ "read_setup": false, "record_votes": false, "read_board": false, "run_board": false, "start_setup": false })
        );
    }

    #[tokio::test]
    async fn before_the_church_has_a_setup_only_the_developer_may_start_one() {
        let app = TestApp::unseeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let (status, me) = app.call(&dev, Method::GET, "/api/me", None).await;
        assert_eq!((status, &me["desks"]), (StatusCode::OK, &json!([])));
        assert_eq!(
            me["may"],
            json!({ "read_setup": false, "record_votes": false, "read_board": false, "run_board": false, "start_setup": true })
        );
        let (_, ana) = app.call(&app.sign_in("ana@example.org").await, Method::GET, "/api/me", None).await;
        assert_eq!(ana["may"]["start_setup"], false);
    }

    #[tokio::test]
    async fn each_route_answers_by_the_charges_that_serve_today() {
        use Expect::{Allowed as A, Forbidden as F, SignedOut as S};
        let app = TestApp::seeded().await;
        let people = app.with_officers().await;
        let names = ["signed out", "nobody", "ana, clerk", "luis, treasurer", "marta, multimedia", "pedro, first elder", "olga, succeeded", "developer"];
        let rename = vote(2, "church", json!({ "church": "Iglesia Central" }));
        let new_meeting = Some(json!({ "date": "2027-01-10", "kind": "regular" }));
        let new_item = Some(json!({ "section": "finanzas", "title": "Diezmos", "kind": "informative", "presenter": null }));
        let approved = Some(json!({ "status": "approved" }));
        let table = [
            (Method::GET, "/api/me", None, [S, A, A, A, A, A, A, A]),
            (Method::GET, "/api/setup", None, [S, F, A, A, A, A, F, A]),
            (Method::GET, "/api/setup/history", None, [S, F, A, A, A, A, F, A]),
            (Method::POST, "/api/setup/history", rename, [S, F, A, F, F, A, F, A]),
            (Method::POST, "/api/setup/charges/2/invitation", None, [S, F, A, F, F, A, F, A]),
            (Method::GET, "/api/meetings", None, [S, F, A, A, F, A, F, A]),
            (Method::GET, "/api/meetings/1", None, [S, F, A, A, F, A, F, A]),
            (Method::POST, "/api/meetings", new_meeting, [S, F, F, F, F, A, F, A]),
            (Method::POST, "/api/meetings/1/items", new_item, [S, F, F, F, F, A, F, A]),
            (Method::PUT, "/api/meetings/1/items/1/status", approved, [S, F, F, F, F, A, F, A]),
            (Method::DELETE, "/api/meetings/1/items/1", None, [S, F, F, F, F, A, F, A]),
            (Method::POST, "/api/meetings/1/advance", None, [S, F, F, F, F, A, F, A]),
        ];
        for (method, uri, body, expected) in table {
            for ((who, name), expect) in people.iter().zip(names).zip(expected) {
                let (status, reply) = app.call(who, method.clone(), uri, body.clone()).await;
                let reply: String = reply.to_string().chars().take(200).collect();
                assert!(expect.matches(status), "{method} {uri} as {name}: expected {expect:?}, got {status} {reply}");
            }
        }
    }

    #[tokio::test]
    async fn a_vote_that_releases_the_clerk_takes_effect_on_her_next_request() {
        let app = TestApp::seeded().await;
        let [_, _, ana, .., dev] = app.with_officers().await;
        let release_ana = vote(2, "church", json!({ "release": [2] }));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/history", release_ana).await.0, StatusCode::CREATED);
        let rename = vote(3, "church", json!({ "church": "Iglesia Central" }));
        let (status, body) = app.call(&ana, Method::POST, "/api/setup/history", rename).await;
        assert_eq!((status, body["error"].as_str()), (StatusCode::FORBIDDEN, Some("recording votes and inviting holders needs the clerk or the first elder")));
        assert_eq!(app.call(&ana, Method::GET, "/api/me", None).await.1["desks"], json!([]), "same session, new answer");
    }

    #[tokio::test]
    async fn an_officer_whose_term_ended_serves_until_the_church_elects_a_successor() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let treasurer = |name: &str, start_year: u16| {
            json!({ "elect": [{ "office": "tesorero", "holder": { "name": name, "email": format!("{}@example.org", name.to_lowercase()) },
                                "term": { "start_year": start_year } }] })
        };
        let luis = app.call(&dev, Method::POST, "/api/setup/history", vote(1, "church", treasurer("Luis", 2025))).await;
        assert_eq!(luis.0, StatusCode::CREATED);
        let luis = app.sign_in("luis@example.org").await;
        assert_eq!(app.call(&luis, Method::GET, "/api/meetings", None).await.0, StatusCode::OK, "his 2025 term ended, but nobody succeeded him");

        let rosa = app.call(&dev, Method::POST, "/api/setup/history", vote(2, "church", treasurer("Rosa", 2026))).await;
        assert_eq!(rosa.0, StatusCode::CREATED);
        assert_eq!(app.call(&luis, Method::GET, "/api/meetings", None).await.0, StatusCode::FORBIDDEN);
        let rosa = app.sign_in("rosa@example.org").await;
        assert_eq!(app.call(&rosa, Method::GET, "/api/meetings", None).await.0, StatusCode::OK);
    }
}
