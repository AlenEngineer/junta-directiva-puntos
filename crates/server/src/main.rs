mod api;
mod seed;
mod store;

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
    // Login (WorkOS) is not wired yet, so anything beyond this machine
    // needs an explicit opt-in instead of exposing the church's data.
    if !addr.ip().is_loopback() && env("MAYORDOMO_PUBLIC_WITHOUT_LOGIN", "") != "1" {
        fail(format!(
            "refusing to listen on {addr}: login is not set up yet. Use a loopback address, \
             or set MAYORDOMO_PUBLIC_WITHOUT_LOGIN=1 on a network you trust."
        ));
    }

    let database = env("DATABASE_URL", "sqlite://mayordomo.db");
    let store = store::Store::open(&database)
        .await
        .unwrap_or_else(|e| fail(format!("cannot open {database}: {e}")));
    let setup_path = PathBuf::from(env("SETUP_FILE", "setup.json"));
    let setup = seed::ensure(&store, &setup_path).await.unwrap_or_else(|e| {
        fail(format!(
            "cannot load the church setup: {e}\nSet SETUP_FILE to seed an empty database, or start from examples/setup.json."
        ))
    });
    println!("{}: setup history at entry {}", setup.church(), setup.latest().0);

    let mut router = api::router(api::App { store });
    if let Ok(dir) = std::env::var("WEB_DIR") {
        router = with_page(router, &dir);
    }

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| fail(format!("bind {addr}: {e}")));
    println!("listening on http://{addr}");
    axum::serve(listener, router).await.expect("server");
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

    async fn get(router: &Router, uri: &str) -> (StatusCode, String) {
        let response = router.clone().oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tokio::test]
    async fn an_unknown_api_path_is_not_found_and_any_other_path_is_the_page() {
        let store = store::Store::open("sqlite::memory:").await.unwrap();
        let router = with_page(api::router(api::App { store }), concat!(env!("CARGO_MANIFEST_DIR"), "/../../web"));
        assert_eq!(get(&router, "/api/no-such-thing").await, (StatusCode::NOT_FOUND, r#"{"error":"not found"}"#.to_owned()));
        let (status, page) = get(&router, "/juntas/1").await;
        assert_eq!(status, StatusCode::OK);
        assert!(page.contains("<title>Mayordomo</title>"), "{page}");
    }
}
