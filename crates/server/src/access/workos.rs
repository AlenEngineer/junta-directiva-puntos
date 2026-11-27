//! The calls Mayordomo makes to WorkOS: the code exchange, plus the two
//! browser redirects to authorize and to log out. `base` is
//! https://api.workos.com in production and a stand-in on a loopback port
//! in tests, so tests exercise these very requests and parsers. The wire
//! shapes stay in this file.

use std::{fmt, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Url;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::store::Session;

pub(super) struct Workos {
    http: reqwest::Client,
    base: String,
    client_id: String,
    api_key: String,
}

/// What AuthKit may hand the initiate login URI, passed on to authorize unchanged.
#[derive(Deserialize)]
pub(super) struct Hints {
    invitation_token: Option<String>,
    login_hint: Option<String>,
}

#[derive(Debug)]
pub enum WorkosError {
    /// WorkOS answered 4xx, such as for a code already used. Its message.
    Refused(String),
    /// The email that signed in is not verified, so it is never matched to a holder.
    Unverified,
    /// No answer, a 5xx, or an answer this client cannot read.
    Unavailable(String),
}

impl fmt::Display for WorkosError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(message) => write!(f, "WorkOS refused: {message}"),
            Self::Unverified => write!(f, "the email that signed in is not verified"),
            Self::Unavailable(why) => write!(f, "no usable answer from WorkOS: {why}"),
        }
    }
}

impl Workos {
    /// Each call times out after 10 seconds, so a slow WorkOS cannot hold a request open.
    pub(super) fn new(base: &str, client_id: String, api_key: String) -> Self {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().expect("an HTTP client");
        Self { http, base: base.trim_end_matches('/').to_owned(), client_id, api_key }
    }

    /// AuthKit's sign-in page, which sends the browser back to `redirect_uri` with a code and `state`.
    pub(super) fn authorize_url(&self, redirect_uri: &str, state: &str, hints: &Hints) -> String {
        let required = [
            ("response_type", "code"),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", redirect_uri),
            ("provider", "authkit"),
            ("state", state),
        ];
        let hints = [("invitation_token", &hints.invitation_token), ("login_hint", &hints.login_hint)];
        let given = hints.into_iter().filter_map(|(name, value)| Some((name, value.as_deref()?)));
        self.link("/user_management/authorize", required.into_iter().chain(given))
    }

    /// Ends the WorkOS session, then sends the browser to `return_to`.
    pub(super) fn logout_url(&self, session_id: &str, return_to: &str) -> String {
        self.link("/user_management/sessions/logout", [("session_id", session_id), ("return_to", return_to)])
    }

    /// Trades the code AuthKit sent back for who signed in. Refuses an email
    /// that is not verified, because the email is the key to every charge.
    pub(super) async fn authenticate(&self, code: &str) -> Result<Session, WorkosError> {
        let exchange = CodeExchange { client_id: &self.client_id, client_secret: &self.api_key, grant_type: "authorization_code", code };
        let reply: Authenticated = read(self.http.post(self.endpoint("/user_management/authenticate")).json(&exchange).send().await).await?;
        if !reply.user.email_verified {
            return Err(WorkosError::Unverified);
        }
        Ok(Session {
            workos_session: session_id(&reply.access_token)?,
            name: display_name(&reply.user),
            workos_user: reply.user.id,
            email: reply.user.email,
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn link<'a>(&self, path: &str, query: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
        Url::parse_with_params(&self.endpoint(path), query).expect("the WorkOS base is a URL").into()
    }
}

#[derive(Serialize)]
struct CodeExchange<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    grant_type: &'static str,
    code: &'a str,
}

#[derive(Deserialize)]
struct Authenticated {
    user: User,
    access_token: String,
}

#[derive(Deserialize)]
struct User {
    id: String,
    email: String,
    email_verified: bool,
    first_name: Option<String>,
    last_name: Option<String>,
}

#[derive(Deserialize)]
struct Claims {
    sid: String,
}

/// A WorkOS error body. Its fields differ by endpoint, so all are optional.
#[derive(Default, Deserialize)]
struct Problem {
    message: Option<String>,
    error_description: Option<String>,
    error: Option<String>,
}

/// The `sid` claim of the access token. The signature is not checked: the
/// token came straight from WorkOS over TLS, in answer to our own request.
fn session_id(access_token: &str) -> Result<String, WorkosError> {
    let unreadable = || WorkosError::Unavailable("the access token has no readable sid".into());
    let claims = access_token.split('.').nth(1).ok_or_else(unreadable)?;
    let claims = URL_SAFE_NO_PAD.decode(claims).map_err(|_| unreadable())?;
    let claims: Claims = serde_json::from_slice(&claims).map_err(|_| unreadable())?;
    Ok(claims.sid)
}

/// First and last name, or the email when WorkOS has neither.
fn display_name(user: &User) -> String {
    let parts: Vec<&str> =
        [&user.first_name, &user.last_name].into_iter().flatten().map(|part| part.trim()).filter(|part| !part.is_empty()).collect();
    if parts.is_empty() { user.email.clone() } else { parts.join(" ") }
}

/// A 2xx body as `T`. A 4xx is `Refused` with WorkOS's message. Anything else is `Unavailable`.
async fn read<T: DeserializeOwned>(sent: reqwest::Result<reqwest::Response>) -> Result<T, WorkosError> {
    let unavailable = |e: reqwest::Error| WorkosError::Unavailable(e.to_string());
    let response = sent.map_err(unavailable)?;
    let status = response.status();
    let body = response.bytes().await.map_err(unavailable)?;
    if status.is_client_error() {
        let problem: Problem = serde_json::from_slice(&body).unwrap_or_default();
        let message = problem.message.or(problem.error_description).or(problem.error);
        return Err(WorkosError::Refused(message.unwrap_or_else(|| status.to_string())));
    }
    if !status.is_success() {
        return Err(WorkosError::Unavailable(format!("it answered {status}")));
    }
    serde_json::from_slice(&body).map_err(|e| WorkosError::Unavailable(format!("unreadable answer: {e}")))
}
