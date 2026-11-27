# Mayordomo

A workspace for the charges a church officer holds. It starts with the first elder's church board agenda.

Any Adventist church can reshape it without touching code. Offices and the board agenda are built from layers, applied in order:

1. The Church Manual (2025 edition), bundled in `crates/domain/data/manual-2025.json`, with the page each office is described on.
2. Any division supplement.
3. The church's own layer, made of its initial setup and every vote since.

Each layer can add an office, replace one by its id, hide offices the church does not use, restore an office it hid, or replace the agenda template. A church's own office records the vote that approved it, and every office records which layer it came from. A charge is an office held by a named person for a term, and its responsibilities come from the catalog.

## A church's setup

The setup changes only by a vote. The database keeps it as a history of entries that the server never edits or deletes. Entry 1 is the initial setup. Every later entry is one vote and what it decided: a new name for the church, offices added, replaced, hidden or restored, the board agenda, and charges elected or released. A vote records the body that voted, the date, and the minute (acta) when there is one. The board can vote only a new board agenda. Every other change, electing the officers included, needs a business meeting (Manual pp. 141-146, 163-164, 167). The catalog and the charges are the bundled manual with this history replayed over it. Nothing else stores them.

The first time the server starts with an empty database, it reads `SETUP_FILE` and stores it as entry 1, with no vote. After that it never reads the file again. `examples/setup.json` and `examples/iglesia.json` show a church that hides two offices and adds a local one. A setup file names at most one layer file, the church's own, and each of its charges names the holder.

| Request | What it does |
|---|---|
| `GET /api/setup` | The church's name, catalog and charges, and `latest`, the last entry applied |
| `GET /api/setup/history` | Every entry, oldest first, with the vote that approved it and what it changed |
| `POST /api/setup/history` | Records a vote and answers 201 with the new entry |

A vote sends as `after` the `latest` entry it was decided against:

```json
{
  "after": 1,
  "vote": { "body": "business_meeting", "date": "2027-01-09", "minute": "Acta 4, voto 12" },
  "change": {
    "catalog": { "offices": [{ "id": "bienvenida", "name": "Coordinador de bienvenida", "board_member": false }] },
    "elect": [{ "office": "bienvenida", "holder": { "name": "Hermano de ejemplo" }, "term": { "start_year": 2027 } }]
  }
}
```

If someone recorded another entry since, or the same vote arrives twice, the server answers 409 and records nothing. A change that would leave the setup invalid gets 422 with the reason, such as `cannot hide unknown office club-de-aventurero`, and the server records nothing.

## Layout

- `crates/domain` holds the types and is the single source of truth for every shape. `catalog` applies the layers into one catalog of offices and agenda sections. `setup` replays the church's history over the manual and decides which votes it accepts. `Charge`, `Term` and `Responsibility` describe what the user holds. `agenda` has `Meeting` and `AgendaItem`.
- `crates/server` keeps the church's setup history, board meetings and their items in SQLite (`crates/server/migrations`), and serves the HTTP API (axum) under `/api`.
- `web` is the Bun and TypeScript front end. `web/src/generated` is exported from `crates/domain` by `cargo test`. Never edit it by hand.

## Develop

```sh
SETUP_FILE=examples/setup.json cargo run -p server   # API on 127.0.0.1:3000, data in ./mayordomo.db
cd web && bun install && bun run dev   # web on localhost:5173, proxies /api
```

`SETUP_FILE` seeds only an empty `mayordomo.db`. To start again from the file, delete `mayordomo.db`.

After changing a domain type, run `cargo test` to regenerate the TypeScript types and commit them. CI fails if they drift.

## Extending

- A new charge is an election, recorded with its vote through `POST /api/setup/history`. So is any other change to a church's setup.
- A new edition or a supplement is a layer file. `cargo test` validates the bundled manual and the example setup.
- A new kind of work is a new `Module` variant with its own module in `crates/domain`, routes in `crates/server` and a view in `web`. Responsibilities point at the module that carries them out.

## Hosting

One server serves the page and the API. The Docker image builds both:

```sh
docker build -t mayordomo .
docker run -p 8080:8080 -v /path/to/church:/data mayordomo
```

`/data` holds `mayordomo.db` and, for the first start, the church's `setup.json` and its layer file. The server reads these settings:

| Variable | Default | Meaning |
|---|---|---|
| `API_ADDR` | `127.0.0.1:3000` (`0.0.0.0:8080` in the image) | Address to listen on |
| `SETUP_FILE` | `setup.json` | The church's initial setup, read only while the database has none |
| `DATABASE_URL` | `sqlite://mayordomo.db` | SQLite database, created and migrated on start |
| `WEB_DIR` | unset | Built page (`web/dist`) to serve beside the API |
| `MAYORDOMO_PUBLIC_WITHOUT_LOGIN` | unset | Set to `1` to listen beyond loopback before login exists |

Login through WorkOS is planned and not built yet. Until it is, anyone who can reach the server can read the church's data and record a vote. The server therefore refuses a non-loopback address unless `MAYORDOMO_PUBLIC_WITHOUT_LOGIN=1` says the network is trusted, so a deploy cannot expose a church's data by accident.
