# Mayordomo

A workspace for the charges a church officer holds. It starts with the first elder's church board agenda.

Any Adventist church can reshape it without touching code. Offices and the board agenda are built from layers, applied in order:

1. The Church Manual (2025 edition), bundled in `crates/domain/data/manual-2025.json`, with the page each office is described on.
2. Any division supplement.
3. The church's own layer.

Each layer can add an office, replace one by its id, hide offices the church does not use, or replace the agenda template. A church's own office records the vote that approved it, and every office records which layer it came from. A charge is an office held for a term, and its responsibilities start from the catalog.

## A church's setup

`setup.json` names the church, lists its layer files and the charges held. `examples/setup.json` and `examples/iglesia.json` show a church that hides two offices and adds a local one. A layer that hides an office it does not know, or lists the same office twice, fails at startup with a message naming it.

## Layout

- `crates/domain` holds the types and is the single source of truth for every shape. `catalog` applies the layers into one catalog of offices and agenda sections. `Charge`, `Term` and `Responsibility` describe what the user holds. `agenda` has `Meeting` and `AgendaItem`.
- `crates/server` loads the church's setup, keeps board meetings and their items in SQLite (`crates/server/migrations`), and serves the HTTP API (axum) under `/api`.
- `web` is the Bun and TypeScript front end. `web/src/generated` is exported from `crates/domain` by `cargo test`. Never edit it by hand.

## Develop

```sh
SETUP_FILE=examples/setup.json cargo run -p server   # API on 127.0.0.1:3000, data in ./mayordomo.db
cd web && bun install && bun run dev   # web on localhost:5173, proxies /api
```

After changing a domain type, run `cargo test` to regenerate the TypeScript types and commit them. CI fails if they drift.

## Extending

- A new charge is a line in `setup.json`.
- A new edition, a supplement or a church change is a layer file. `cargo test` validates the bundled manual and the example setup.
- A new kind of work is a new `Module` variant with its own module in `crates/domain`, routes in `crates/server` and a view in `web`. Responsibilities point at the module that carries them out.

## Hosting

One server serves the page and the API. The Docker image builds both:

```sh
docker build -t mayordomo .
docker run -p 8080:8080 -v /path/to/church:/data mayordomo
```

`/data` holds the church's `setup.json`, its layer files and `mayordomo.db`. The server reads these settings:

| Variable | Default | Meaning |
|---|---|---|
| `API_ADDR` | `127.0.0.1:3000` (`0.0.0.0:8080` in the image) | Address to listen on |
| `SETUP_FILE` | `setup.json` | The church's setup |
| `DATABASE_URL` | `sqlite://mayordomo.db` | SQLite database, created and migrated on start |
| `WEB_DIR` | unset | Built page (`web/dist`) to serve beside the API |
| `MAYORDOMO_PUBLIC_WITHOUT_LOGIN` | unset | Set to `1` to listen beyond loopback before login exists |

Login through WorkOS is planned and not built yet. Until it is, the server refuses a non-loopback address unless `MAYORDOMO_PUBLIC_WITHOUT_LOGIN=1` says the network is trusted, so a deploy cannot expose a church's data by accident.
