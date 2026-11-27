mod access;
mod api;
mod store;
#[cfg(test)]
mod testing;

use std::{net::SocketAddr, path::PathBuf};

use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}

fn fail(message: String) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

#[tokio::main]
async fn main() {
    let addr: SocketAddr = env("API_ADDR", "127.0.0.1:3000")
        .parse()
        .unwrap_or_else(|e| fail(format!("API_ADDR: {e}")));
    let config = login_settings(|name| std::env::var(name).ok()).unwrap_or_else(|e| fail(e));

    let database = env("DATABASE_URL", "sqlite://mayordomo.db");
    let store = store::Store::open(&database).await.unwrap_or_else(|e| fail(format!("cannot open {database}: {e}")));
    match store.setup().await.unwrap_or_else(|e| fail(format!("cannot read the church setup: {e}"))) {
        Some(setup) => println!("{}: setup history at entry {}", setup.church(), setup.latest().0),
        None => println!("no church setup yet: the developer enters it after signing in"),
    }
    match &config.developer {
        Some(email) => println!("{email} is the developer and may do everything"),
        None => println!("MAYORDOMO_DEVELOPER_EMAIL is not set, so nobody may do everything"),
    }

    let mut router = api::router(access::App::new(store, config, access::Clock::system()));
    if let Ok(dir) = std::env::var("WEB_DIR") {
        router = with_page(router, &dir);
    }

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| fail(format!("bind {addr}: {e}")));
    if addr.ip().is_loopback() {
        // WorkOS knows the origin as localhost, not as 127.0.0.1.
        println!("listening on http://localhost:{}", addr.port());
    } else {
        println!("listening on {addr}");
    }
    axum::serve(listener, router).await.expect("server");
}

/// What signing in needs. Login is always on, so a missing or blank
/// `WORKOS_CLIENT_ID` or `WORKOS_API_KEY` stops the server before it serves anything.
fn login_settings(var: impl Fn(&str) -> Option<String>) -> Result<access::Config, String> {
    let required = |name: &str| {
        var(name).filter(|value| !value.trim().is_empty()).ok_or_else(|| format!("{name} is not set; see \"Signing in\" in README.md"))
    };
    Ok(access::Config {
        workos_api: access::WORKOS_API.to_owned(),
        workos_client_id: required("WORKOS_CLIENT_ID")?,
        workos_api_key: required("WORKOS_API_KEY")?,
        developer: var("MAYORDOMO_DEVELOPER_EMAIL").map(|email| email.trim().to_owned()).filter(|email| !email.is_empty()),
    })
}

/// Serves the built page in `dir` for every path the API does not route.
fn with_page(router: Router, dir: &str) -> Router {
    let index = PathBuf::from(dir).join("index.html");
    router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;
    use crate::testing::TestApp;

    async fn get(router: &Router, uri: &str) -> (StatusCode, String) {
        let response = router.clone().oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn an_unknown_api_path_is_not_found_and_any_other_path_is_the_page() {
        let router = with_page(TestApp::unseeded().await.router(), concat!(env!("CARGO_MANIFEST_DIR"), "/../../web"));
        assert_eq!(get(&router, "/api/no-such-thing").await, (StatusCode::NOT_FOUND, r#"{"error":"not found"}"#.to_owned()));
        let (status, page) = get(&router, "/juntas/1").await;
        assert_eq!(status, StatusCode::OK);
        assert!(page.contains("<title>Mayordomo</title>"), "{page}");
    }

    #[test]
    fn the_server_needs_its_workos_keys_to_start() {
        let settings = |vars: &[(&str, &str)]| {
            let vars: Vec<(String, String)> = vars.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect();
            login_settings(move |name| vars.iter().find(|(n, _)| n == name).map(|(_, value)| value.clone()))
        };
        let keys = [("WORKOS_CLIENT_ID", "client_1"), ("WORKOS_API_KEY", "sk_test_1")];
        let config = settings(&keys).unwrap();
        assert_eq!((config.workos_client_id.as_str(), config.workos_api_key.as_str()), ("client_1", "sk_test_1"));
        assert_eq!(config.developer, None);
        for (missing, vars) in [("WORKOS_CLIENT_ID", &keys[1..]), ("WORKOS_API_KEY", &keys[..1])] {
            assert!(settings(vars).err().unwrap().contains(missing), "{missing}");
        }
        assert!(settings(&[keys[0], ("WORKOS_API_KEY", " ")]).err().unwrap().contains("WORKOS_API_KEY"), "a blank key is missing");
        let with_developer = settings(&[keys[0], keys[1], ("MAYORDOMO_DEVELOPER_EMAIL", " dev@example.org ")]).unwrap();
        assert_eq!(with_developer.developer.as_deref(), Some("dev@example.org"));
    }
}
