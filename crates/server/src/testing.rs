//! A Mayordomo to test against: a seeded store, the real router, and a
//! stand-in for WorkOS on a loopback port. Nothing here calls WorkOS.

use std::path::{Path, PathBuf};

use axum::{
    Json, Router,
    body::Body,
    http::{HeaderValue, Method, Request, Response, StatusCode, header, request},
    response::IntoResponse,
    routing,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use http_body_util::BodyExt;
use reqwest::Url;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::access::{App, Clock, Config};
use crate::store::Store;

pub const DEVELOPER: &str = "dev@example.org";
pub const CLIENT_ID: &str = "client_test";
pub const API_KEY: &str = "sk_test_fake";
/// 2026-12-06T12:00:00Z. Every test runs on this day, so a term elected
/// for 2026 serves whenever the tests run.
pub const TODAY: i64 = 1_796_558_400;

pub struct TestApp {
    router: Router,
    pub workos: FakeWorkos,
}

impl TestApp {
    /// The example church from examples/setup.json, in memory.
    pub async fn seeded() -> Self {
        Self::open("sqlite::memory:", "setup.json").await
    }

    /// The database at `url`, seeded from `setup_file` while it is empty, as `main` does.
    pub async fn open(url: &str, setup_file: &str) -> Self {
        let store = Store::open(url).await.unwrap();
        crate::seed::ensure(&store, &examples().join(setup_file)).await.unwrap();
        Self::serving(store).await
    }

    /// A database that was never seeded.
    pub async fn unseeded() -> Self {
        Self::serving(Store::open("sqlite::memory:").await.unwrap()).await
    }

    async fn serving(store: Store) -> Self {
        let workos = FakeWorkos::start().await;
        let config = Config {
            workos_api: workos.url.clone(),
            workos_client_id: CLIENT_ID.into(),
            workos_api_key: API_KEY.into(),
            developer: Some(DEVELOPER.into()),
        };
        Self { router: crate::api::router(App::new(store, config, Clock::fixed(TODAY))), workos }
    }

    pub fn router(&self) -> Router {
        self.router.clone()
    }

    /// Signs `email` in the way a browser does: the login, then the callback
    /// with the state the login set. The stand-in signs in whoever the code names.
    pub async fn sign_in(&self, email: &str) -> Cookie {
        let back = self.callback_with_code(email).await;
        Cookie::from_set_cookie(&set_cookie(&back, "mayordomo_session").expect("signed in"))
    }

    /// The callback of a fresh login, as AuthKit sends the browser back with `code`.
    pub async fn callback_with_code(&self, code: &str) -> Response<Body> {
        let login = self.send(get("/api/auth/login")).await;
        let state = query(&location(&login), "state");
        let back = Url::parse_with_params("http://localhost:3000/api/auth/callback", [("code", code), ("state", &state)]).unwrap();
        let login_cookie = cookie_pair(&set_cookie(&login, "mayordomo_login").unwrap());
        self.send(get(&format!("{}?{}", back.path(), back.query().unwrap())).header(header::COOKIE, login_cookie)).await
    }

    /// A JSON request as `who`, from a browser on localhost:3000.
    pub async fn call(&self, who: &Cookie, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut request = Request::builder().method(method).uri(uri).header(header::CONTENT_TYPE, "application/json");
        if let Some(pair) = &who.0 {
            request = request.header(header::COOKIE, pair);
        }
        let response = self.send_body(request, body.map_or_else(Body::empty, |b| Body::from(b.to_string()))).await;
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    /// A request with no body, from a browser on localhost:3000 unless it names another host.
    pub async fn send(&self, request: request::Builder) -> Response<Body> {
        self.send_body(request, Body::empty()).await
    }

    async fn send_body(&self, request: request::Builder, body: Body) -> Response<Body> {
        let mut request = request.body(body).unwrap();
        request.headers_mut().entry(header::HOST).or_insert(HeaderValue::from_static("localhost:3000"));
        self.router.clone().oneshot(request).await.unwrap()
    }
}

/// A session cookie, or none for a caller who is signed out.
#[derive(Debug, Clone)]
pub struct Cookie(Option<String>);

impl Cookie {
    pub fn none() -> Self {
        Self(None)
    }

    /// The cookie a browser keeps from this `Set-Cookie` header.
    pub fn from_set_cookie(set_cookie: &str) -> Self {
        Self(Some(cookie_pair(set_cookie)))
    }

    /// `mayordomo_session=…`, for a `Cookie` header.
    pub fn header(&self) -> &str {
        self.0.as_deref().expect("signed in")
    }
}

/// api.workos.com on a loopback port. `POST /user_management/authenticate`
/// needs the test client id and API key, else 401. The code is the email it
/// signs in, with the WorkOS session "session_for_<email>". The code
/// "unverified:<email>" signs that email in unverified, and "expired" is
/// refused with 400, as a code already used is.
pub struct FakeWorkos {
    pub url: String,
}

impl FakeWorkos {
    async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let fake = Router::new().route("/user_management/authenticate", routing::post(authenticate));
        tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
        Self { url }
    }
}

async fn authenticate(Json(body): Json<Value>) -> axum::response::Response {
    if body["client_id"] != CLIENT_ID || body["client_secret"] != API_KEY || body["grant_type"] != "authorization_code" {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "invalid_client", "error_description": "Invalid client secret." })))
            .into_response();
    }
    let code = body["code"].as_str().unwrap_or_default();
    if code == "expired" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant", "error_description": "The code has expired." })))
            .into_response();
    }
    let (email, verified) = code.strip_prefix("unverified:").map_or((code, true), |email| (email, false));
    let claims = URL_SAFE_NO_PAD.encode(json!({ "sid": format!("session_for_{email}") }).to_string());
    Json(json!({
        "user": {
            "object": "user",
            "id": format!("user_for_{email}"),
            "email": email,
            "email_verified": verified,
            "first_name": email.split('@').next(),
            "last_name": "Prueba",
        },
        "organization_id": null,
        "access_token": format!("eyJhbGciOiJSUzI1NiJ9.{claims}.firma"),
        "refresh_token": "refresh_token",
    }))
    .into_response()
}

pub fn get(uri: &str) -> request::Builder {
    Request::get(uri)
}

pub fn post(uri: &str) -> request::Builder {
    Request::post(uri)
}

/// Where a redirect sends the browser, as the response says it.
pub fn location(response: &Response<Body>) -> String {
    response.headers()[header::LOCATION].to_str().unwrap().to_owned()
}

/// Query parameter `name` of the absolute `url`.
pub fn query(url: &str, name: &str) -> String {
    let url = Url::parse(url).unwrap();
    url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned()).unwrap_or_else(|| panic!("{url} has no {name}"))
}

/// The `Set-Cookie` header that sets cookie `name`, if the response has one.
pub fn set_cookie(response: &Response<Body>, name: &str) -> Option<String> {
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap().to_owned())
        .find(|cookie| cookie.starts_with(&format!("{name}=")))
}

/// `name=value` from a `Set-Cookie` header, as the browser sends it back.
pub fn cookie_pair(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_owned()
}

pub fn examples() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

pub fn vote(after: i64, body: &str, change: Value) -> Option<Value> {
    Some(json!({ "after": after, "vote": { "body": body, "date": "2026-03-07", "minute": "Acta 3/2026" }, "change": change }))
}
