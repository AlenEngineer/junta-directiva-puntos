//! Signing in and out through WorkOS AuthKit, and the cookies that carry
//! it. These routes are public: they run before anyone is signed in.

use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, header},
    response::{AppendHeaders, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;

use super::{
    ApiError, AppState,
    workos::{Hints, WorkosError},
};

const SESSION: &str = "mayordomo_session";
const LOGIN: &str = "mayordomo_login";
const CALLBACK: &str = "/api/auth/callback";
/// A sign-in lasts 30 days from the callback, used or not.
const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;
/// WorkOS's code is valid for 10 minutes, and the login's `state` as long.
const LOGIN_SECONDS: i64 = 10 * 60;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", get(login))
        .route(CALLBACK, get(callback))
        .route("/api/auth/logout", post(logout))
}

/// The initiate login URI. Starts a sign-in with a fresh `state`, kept in a
/// short-lived cookie and sent in the authorize URL.
async fn login(State(app): State<AppState>, headers: HeaderMap, Query(hints): Query<Hints>) -> Response {
    let origin = Origin::of(&headers);
    let state = token();
    let authorize = app.workos.authorize_url(&origin.url(CALLBACK), &state, &hints);
    (AppendHeaders([origin.cookie(LOGIN, &state, "/api/auth", LOGIN_SECONDS)]), Redirect::to(&authorize)).into_response()
}

/// What AuthKit sends back: a code and the state, or an `error` instead of the code.
#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Checks the state, trades the code for who signed in, and opens a session.
async fn callback(State(app): State<AppState>, headers: HeaderMap, Query(back): Query<Callback>) -> Response {
    let origin = Origin::of(&headers);
    if let Some(error) = &back.error {
        eprintln!("sign-in failed: AuthKit answered {error}: {}", back.error_description.as_deref().unwrap_or(""));
        return refuse(&origin, "failed");
    }
    let (Some(code), Some(state)) = (back.code, back.state) else {
        eprintln!("sign-in failed: the callback has no code or no state");
        return refuse(&origin, "failed");
    };
    if cookie(&headers, LOGIN) != Some(state.as_str()) {
        eprintln!("sign-in failed: the state does not match this browser's login cookie (cookie present: {})", cookie(&headers, LOGIN).is_some());
        return refuse(&origin, "failed");
    }
    let session = match app.workos.authenticate(&code).await {
        Ok(session) => session,
        Err(WorkosError::Unverified) => return refuse(&origin, "unverified"),
        Err(e) => {
            eprintln!("sign-in failed: {e}");
            return refuse(&origin, "failed");
        }
    };
    let (now, token) = (app.clock.now(), token());
    if let Err(e) = app.store.open_session(&token, &session, now.unix, now.unix + SESSION_SECONDS).await {
        eprintln!("sign-in failed: store error: {e}");
        return refuse(&origin, "failed");
    }
    let cookies = [origin.cookie(LOGIN, "", "/api/auth", 0), origin.cookie(SESSION, &token, "/api", SESSION_SECONDS)];
    (AppendHeaders(cookies), Redirect::to("/")).into_response()
}

/// Back to the page signed out, with why in `?login=`. Forgets the login.
fn refuse(origin: &Origin, why: &str) -> Response {
    (AppendHeaders([origin.cookie(LOGIN, "", "/api/auth", 0)]), Redirect::to(&format!("/?login={why}"))).into_response()
}

/// Ends the session here, then sends the browser to end it at WorkOS.
/// Signing out twice just goes back to the page. A post without the
/// session cookie, as a form on another site sends it, changes nothing.
async fn logout(State(app): State<AppState>, headers: HeaderMap) -> Response {
    let Some(token) = session_token(&headers) else { return Redirect::to("/").into_response() };
    let origin = Origin::of(&headers);
    let forget = AppendHeaders([origin.cookie(SESSION, "", "/api", 0)]);
    match app.store.close_session(token).await {
        Ok(Some(workos_session)) => (forget, Redirect::to(&app.workos.logout_url(&workos_session, &origin.url("/")))).into_response(),
        Ok(None) => (forget, Redirect::to("/")).into_response(),
        Err(e) => ApiError::Store(e).into_response(),
    }
}

/// The session token the browser sent, if any.
pub(super) fn session_token(headers: &HeaderMap) -> Option<&str> {
    cookie(headers, SESSION)
}

/// The value of cookie `name` across the request's `Cookie` headers.
fn cookie<'h>(headers: &'h HeaderMap, name: &str) -> Option<&'h str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(name)?.strip_prefix('='))
}

/// 32 random bytes from the OS, base64url without padding.
fn token() -> String {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).expect("the OS gives random bytes");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Where the browser reached us: `X-Forwarded-Host` when a proxy sets it
/// (web/dev.ts does), else `Host`. It names the callback WorkOS sends the
/// browser back to, and decides `Secure`. Only localhost, 127.0.0.1 and
/// [::1] are plain HTTP, where the dev servers run. Every other host is HTTPS.
struct Origin {
    host: String,
    local: bool,
}

impl Origin {
    fn of(headers: &HeaderMap) -> Self {
        let named = |name: &str| {
            let value = headers.get(name)?.to_str().ok()?.split(',').next()?.trim();
            (!value.is_empty()).then_some(value)
        };
        let host = named("x-forwarded-host").or_else(|| named("host")).unwrap_or("localhost").to_owned();
        let name = match host.rfind(':') {
            Some(colon) if !host[colon..].contains(']') => &host[..colon],
            _ => &host,
        };
        let local = matches!(name, "localhost" | "127.0.0.1" | "[::1]");
        Self { host, local }
    }

    /// `path` on this origin.
    fn url(&self, path: &str) -> String {
        let scheme = if self.local { "http" } else { "https" };
        format!("{scheme}://{}{path}", self.host)
    }

    /// A `Set-Cookie` header: HttpOnly, SameSite=Lax, and Secure off the
    /// local hosts. `max_age` 0 forgets the cookie.
    fn cookie(&self, name: &str, value: &str, path: &str, max_age: i64) -> (HeaderName, HeaderValue) {
        let secure = if self.local { "" } else { "; Secure" };
        let cookie = format!("{name}={value}; Path={path}; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}");
        (header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("cookie values are base64url"))
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{Method, StatusCode, header};

    use crate::store::tests::TempDatabase;
    use crate::testing::{CLIENT_ID, DEVELOPER, TestApp, cookie_pair, get, location, post, query, set_cookie};

    #[tokio::test]
    async fn signing_in_checks_the_state_and_sets_a_session_cookie() {
        let app = TestApp::seeded().await;
        let login = app.send(get("/api/auth/login")).await;
        assert_eq!(login.status(), StatusCode::SEE_OTHER);
        let authorize = location(&login);
        assert!(authorize.starts_with(&format!("{}/user_management/authorize?", app.workos.url)), "{authorize}");
        for (name, value) in [
            ("response_type", "code"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", "http://localhost:3000/api/auth/callback"),
            ("provider", "authkit"),
        ] {
            assert_eq!(query(&authorize, name), value, "{name}");
        }
        let state = query(&authorize, "state");
        let login_cookie = set_cookie(&login, "mayordomo_login").unwrap();
        assert_eq!(cookie_pair(&login_cookie), format!("mayordomo_login={state}"));
        assert!(login_cookie.contains("HttpOnly") && login_cookie.contains("SameSite=Lax"), "{login_cookie}");

        let callback = |state: &str| {
            get(&format!("/api/auth/callback?code=ana%40example.org&state={state}")).header(header::COOKIE, cookie_pair(&login_cookie))
        };
        let forged = app.send(callback("another-state")).await;
        assert_eq!(location(&forged), "/?login=failed");
        assert!(set_cookie(&forged, "mayordomo_session").is_none());
        let without_cookie = app.send(get(&format!("/api/auth/callback?code=ana%40example.org&state={state}"))).await;
        assert_eq!(location(&without_cookie), "/?login=failed", "a login this browser did not start");

        let back = app.send(callback(&state)).await;
        assert_eq!(location(&back), "/");
        let session = set_cookie(&back, "mayordomo_session").unwrap();
        assert!(session.contains("Path=/api") && session.contains("HttpOnly") && session.contains("SameSite=Lax"), "{session}");
        assert!(set_cookie(&back, "mayordomo_login").unwrap().contains("Max-Age=0"), "the login is forgotten");
        let (status, me) = app.call(&crate::testing::Cookie::from_set_cookie(&session), Method::GET, "/api/me", None).await;
        assert_eq!((status, me["email"].as_str()), (StatusCode::OK, Some("ana@example.org")));
    }

    #[tokio::test]
    async fn the_callback_and_the_cookies_follow_the_host_the_browser_used() {
        let app = TestApp::seeded().await;
        for (host, forwarded, callback, secure) in [
            ("localhost:3000", None, "http://localhost:3000/api/auth/callback", false),
            ("127.0.0.1:3000", Some("localhost:5173"), "http://localhost:5173/api/auth/callback", false),
            ("[::1]:3000", None, "http://[::1]:3000/api/auth/callback", false),
            ("mayordomo.example.org", None, "https://mayordomo.example.org/api/auth/callback", true),
        ] {
            let mut request = get("/api/auth/login").header(header::HOST, host);
            if let Some(forwarded) = forwarded {
                request = request.header("x-forwarded-host", forwarded);
            }
            let login = app.send(request).await;
            assert_eq!(query(&location(&login), "redirect_uri"), callback);
            let login_cookie = set_cookie(&login, "mayordomo_login").unwrap();
            assert_eq!(login_cookie.ends_with("; Secure"), secure, "{callback}");

            let state = query(&location(&login), "state");
            let mut request = get(&format!("/api/auth/callback?code=ana%40example.org&state={state}"))
                .header(header::HOST, host)
                .header(header::COOKIE, cookie_pair(&login_cookie));
            if let Some(forwarded) = forwarded {
                request = request.header("x-forwarded-host", forwarded);
            }
            let session = set_cookie(&app.send(request).await, "mayordomo_session").unwrap();
            assert_eq!(session.ends_with("; Secure"), secure, "{callback}");
        }
    }

    #[tokio::test]
    async fn authkit_hints_go_on_to_authorize() {
        let app = TestApp::seeded().await;
        let login = app.send(get("/api/auth/login?invitation_token=inv_01&login_hint=pedro%40example.org")).await;
        let authorize = location(&login);
        assert_eq!(query(&authorize, "invitation_token"), "inv_01");
        assert_eq!(query(&authorize, "login_hint"), "pedro@example.org");
    }

    #[tokio::test]
    async fn an_unverified_email_is_not_signed_in() {
        let app = TestApp::seeded().await;
        let back = app.callback_with_code(&format!("unverified:{DEVELOPER}")).await;
        assert_eq!(location(&back), "/?login=unverified");
        assert!(set_cookie(&back, "mayordomo_session").is_none());
    }

    #[tokio::test]
    async fn a_refused_code_an_authkit_error_or_workos_down_signs_nobody_in() {
        let app = TestApp::seeded().await;
        let refused = app.callback_with_code("expired").await;
        assert_eq!(location(&refused), "/?login=failed");
        assert!(set_cookie(&refused, "mayordomo_session").is_none());
        let error = app.send(get("/api/auth/callback?error=access_denied&state=x")).await;
        assert_eq!(location(&error), "/?login=failed");
        app.workos.go_down();
        let down = app.callback_with_code("ana@example.org").await;
        assert_eq!(location(&down), "/?login=failed");
        assert!(set_cookie(&down, "mayordomo_session").is_none());
    }

    #[tokio::test]
    async fn signing_out_ends_the_session_here_and_at_workos() {
        let app = TestApp::seeded().await;
        let ana = app.sign_in("ana@example.org").await;
        let out = app.send(post("/api/auth/logout").header(header::COOKIE, ana.header())).await;
        let to = location(&out);
        assert!(to.starts_with(&format!("{}/user_management/sessions/logout?", app.workos.url)), "{to}");
        assert_eq!(query(&to, "session_id"), "session_for_ana@example.org");
        assert_eq!(query(&to, "return_to"), "http://localhost:3000/");
        assert!(set_cookie(&out, "mayordomo_session").unwrap().contains("Max-Age=0"));
        assert_eq!(app.call(&ana, Method::GET, "/api/me", None).await.0, StatusCode::UNAUTHORIZED);
        let again = app.send(post("/api/auth/logout").header(header::COOKIE, ana.header())).await;
        assert_eq!(location(&again), "/", "signing out twice is harmless");

        let pedro = app.sign_in("pedro@example.org").await;
        let from_another_site = app.send(post("/api/auth/logout")).await;
        assert_eq!(location(&from_another_site), "/");
        assert!(set_cookie(&from_another_site, "mayordomo_session").is_none(), "a post without the cookie forgets nothing");
        assert_eq!(app.call(&pedro, Method::GET, "/api/me", None).await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn a_session_survives_a_restart() {
        let database = TempDatabase::new("session-restart");
        let ana = TestApp::open(&database.url(), "setup.json").await.sign_in("ana@example.org").await;
        let app = TestApp::open(&database.url(), "no-such-file.json").await;
        assert_eq!(app.call(&ana, Method::GET, "/api/me", None).await.0, StatusCode::OK);
    }
}
