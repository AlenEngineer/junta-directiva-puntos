# Mayordomo

A workspace for the charges a church officer holds. It starts with the first elder's church board agenda.

Any Adventist church can reshape it without touching code. Offices and the board agenda are built from layers, applied in order:

1. The Church Manual (2025 edition), bundled in `crates/domain/data/manual-2025.json`, with the page each office is described on.
2. Any division supplement.
3. The church's own layer, made of its initial setup and every vote since.

Each layer can add an office, replace one by its id, hide offices the church does not use, restore an office it hid, or replace the agenda template. A church's own office records the vote that approved it, and every office records which layer it came from. A charge is an office held by a named person for a term, and its responsibilities come from the catalog.

## A church's setup

The setup changes only by a vote. The database keeps it as a history of entries that the server never edits or deletes. Entry 1 is the initial setup. Every later entry is one vote and what it decided: a new name for the church, offices added, replaced, hidden or restored, the board agenda, and charges elected or released. A vote records the body that voted, the date, and the minute (acta) when there is one. The board can vote only a new board agenda. Every other change, electing the officers included, needs a vote of the church, taken during the Sabbath service or at a business meeting (Manual pp. 141-146, 163-164, 167). The catalog and the charges are the bundled manual with this history replayed over it. Nothing else stores them.

Terms count church years. A church year starts in January unless the setup names another month in `year_starts`, a number from 1 to 12. The initial setup sets it, and a vote of the church can change it. With October, church year 2026 runs from 2026-10-01 to 2027-09-30, and so does a one-year term that starts in 2026. The server takes today's date in UTC.

A new database has no setup. The developer signs in and enters it in the app: the church's name, the month its year starts, the offices it does not use, any office of its own, and the officers who serve today. It is stored as entry 1, with no vote, and can be entered only once. Until then the developer may do nothing else and nobody else may do anything.

In the app, the clerk or the first elder records each later vote of the church the same way: office by office, as the nominating committee reports it. Before saving, the page shows the change grouped by person, and after saving it offers one invitation per person elected with an email. A draft stays in the browser until it is saved. `examples/iglesia.json` shows a church's offices in the layer format a vote's `catalog` uses: it hides two offices and adds a local one.

| Request | What it does |
|---|---|
| `GET /api/setup/initial` | Before the church has a setup, the developer gets the bundled manual's catalog to start from |
| `POST /api/setup/initial` | The developer's first setup, a `Change` with no vote. 201 with entry 1, 409 once a setup exists |
| `GET /api/setup` | The church's name, `year_starts`, catalog and charges, `latest` (the last entry applied), `church_year` (today's) and `serving` (the charges that serve in it) |
| `GET /api/setup/history` | Every entry, oldest first, with the vote that approved it and what it changed |
| `POST /api/setup/history` | Records a vote and answers 201 with the new entry |
| `POST /api/setup/charges/{id}/invitation` | Asks WorkOS to invite the holder of charge `id` to sign in. See "Invite a holder" |

A vote sends as `after` the `latest` entry it was decided against:

```json
{
  "after": 1,
  "vote": { "body": "church", "date": "2027-01-09", "minute": "Acta 4, voto 12" },
  "change": {
    "catalog": { "offices": [{ "id": "bienvenida", "name": "Coordinador de bienvenida", "board_member": false }] },
    "elect": [{ "office": "bienvenida", "holder": { "name": "Hermano de ejemplo" }, "term": { "start_year": 2027 } }]
  }
}
```

If someone recorded another entry since, or the same vote arrives twice, the server answers 409 and records nothing. A change that would leave the setup invalid gets 422 with the reason, such as `cannot hide unknown office club-de-aventurero`, and the server records nothing.

## Signing in

Everyone signs in through WorkOS AuthKit. WorkOS says only who signed in, with a verified email and a name. It never knows offices. What a person may do comes from the charges they hold that serve today, matched by email whatever its case. The server reads them from the setup again on every request, so a vote that elects or releases someone changes what they may do on their next request.

A charge serves through its term. After its term, it serves until the church elects a successor, which is another charge for the same office whose term starts later. An officer stops when a successor is elected (Manual pp. 91-92), so the officers keep working while the next election is not yet recorded.

| Who | May |
|---|---|
| Anyone | `GET /api/health`. Sign in at `/api/auth/login` and sign out with `POST /api/auth/logout` |
| Anyone signed in | `GET /api/me`: who they are, the charges they hold that serve today, and what those allow |
| Anyone holding a charge that serves | Read the setup and its history |
| The clerk (`secretario`) or the first elder (`primer-anciano`) | Record votes, and invite a charge's holder to sign in |
| A board member, an office with `board_member: true` | Read the board's meetings |
| A charge whose responsibilities carry the `agenda` module, the first elder in the bundled manual | Create board meetings, edit their items, call them and mark them held |
| The developer, `MAYORDOMO_DEVELOPER_EMAIL` | Everything. The developer signs in like anyone else |

Signed out, every other `/api` request gets 401. Signed in, a request the charges do not allow gets 403, and its `error` says what it needs. An unknown `/api` path gets 404.

The conference appoints the pastor, so the catalog has no pastor's office and a pastor gets no access yet. That is a follow-up.

### Invite a holder

`POST /api/setup/charges/{id}/invitation` asks WorkOS to email the holder of charge `id` an invitation to sign up, in Spanish. It answers 202 with the email and the time the invitation expires. A holder elected without an email gets 422. To give them one, record a vote that elects them again with it. When WorkOS refuses, for example because it already invited that email, the answer is 409 with WorkOS's message. When WorkOS does not answer, it is 502.

### Set up WorkOS

In each WorkOS environment, staging to develop and production for the church, set:

- Redirect URI: `<origin>/api/auth/callback`. Staging has `http://localhost:5173` and `http://localhost:3000`.
- Initiate login URI: `<origin>/api/auth/login`.
- Sign-out redirect: `<origin>/`. Signing out ends the session at WorkOS too, then comes back here.
- AuthKit language: Spanish.
- Optionally, invite-only sign-up, so only holders the clerk invited can make an account.

Open the app at `localhost`, not `127.0.0.1`, because WorkOS knows only the origins registered above. Only `localhost`, `127.0.0.1` and `[::1]` work over plain HTTP. On any other host, serve the app over HTTPS. The server marks its cookies `Secure` there and gives WorkOS an `https` callback.

## Layout

- `crates/domain` holds the types and is the single source of truth for every shape. `catalog` applies the layers into one catalog of offices and agenda sections. `setup` replays the church's history over the manual and decides which votes it accepts. `Charge`, `Term` and `Responsibility` describe what the user holds. `access` decides what a person signed in may do, from the charges they hold that serve today. `agenda` has `Meeting` and `AgendaItem`.
- `crates/server` keeps the church's setup history, board meetings and their items, and the sessions of those signed in, in SQLite (`crates/server/migrations`). It serves the HTTP API (axum) under `/api`. Its `access` module signs people in and is the only way a route reaches the church's data.
- `web` is the Bun and TypeScript front end. `web/src/generated` is exported from `crates/domain` by `cargo test`. Never edit it by hand.

## Develop

```sh
export WORKOS_CLIENT_ID=client_… WORKOS_API_KEY=sk_test_… MAYORDOMO_DEVELOPER_EMAIL=you@example.org
cargo run -p server                                  # API on localhost:3000, data in ./mayordomo.db
cd web && bun install && bun run dev                 # open http://localhost:5173, which proxies /api
```

The two WorkOS values come from the staging environment. `cargo test` needs none of them, because the tests sign in against a stand-in for WorkOS.

On a new `mayordomo.db`, sign in as the developer to enter the first setup. To start again, delete `mayordomo.db`.

After changing a domain type, run `cargo test` to regenerate the TypeScript types and commit them. CI fails if they drift.

## Extending

- A new charge is an election, recorded with its vote through `POST /api/setup/history`. So is any other change to a church's setup.
- A new edition or a supplement is a layer file. `cargo test` validates the bundled manual and the example church.
- A new kind of work is a new `Module` variant with its own module in `crates/domain`, a `May` field and its rule in `domain::access`, a permission and the operations it opens in `crates/server/src/access`, routes in `crates/server/src/api.rs` and a view in `web`. Responsibilities point at the module that carries them out. A route reaches the church's data only through a `Can<…>`, so it cannot skip the check.

## Hosting

One server serves the page and the API. The Docker image builds both:

```sh
docker build -t mayordomo .
docker run -p 8080:8080 -v /path/to/church:/data \
  -e WORKOS_CLIENT_ID=client_… -e WORKOS_API_KEY=sk_live_… -e MAYORDOMO_DEVELOPER_EMAIL=you@example.org \
  mayordomo
```

`/data` holds `mayordomo.db`. The server reads these settings:

| Variable | Default | Meaning |
|---|---|---|
| `API_ADDR` | `127.0.0.1:3000` (`0.0.0.0:8080` in the image) | Address to listen on |
| `DATABASE_URL` | `sqlite://mayordomo.db` | SQLite database, created and migrated on start |
| `WEB_DIR` | unset | Built page (`web/dist`) to serve beside the API |
| `WORKOS_CLIENT_ID` | required | The WorkOS environment's client id. The server does not start without it |
| `WORKOS_API_KEY` | required | The environment's API key (`sk_…`). The server does not start without it |
| `MAYORDOMO_DEVELOPER_EMAIL` | unset | The developer's email. Signed in, the developer may do everything |

Pass the WorkOS settings with `docker run -e`, and never build them into the image. The image installs CA certificates, because the server checks WorkOS's certificate against the system's.
