# Mayordomo

A workspace for the charges a church officer holds. It starts with the first elder's church board agenda.

The offices come from the Church Manual (2025 edition) as data in `crates/domain/data/manual-2025.json`, with the page each one is described on. A charge is an office held for a term, with responsibilities that start from the manual and that the church adjusts to how it works. A church can also hold an office it created locally, recorded with the vote that approved it. A new manual edition or a division supplement is a data change, not a code change.

## Layout

- `crates/domain` holds the types and is the single source of truth for every shape. `catalog` loads the manual's offices and board agenda sections. `Charge`, `Office`, `Term` and `Responsibility` describe what the user holds. `agenda` has `Meeting` and `AgendaItem`.
- `crates/server` is the HTTP API (axum), under `/api`.
- `web` is the Bun and TypeScript front end. `web/src/generated` is exported from `crates/domain` by `cargo test`. Never edit it by hand.

## Develop

```sh
cargo run -p server          # API on 127.0.0.1:3000
cd web && bun install && bun run dev   # web on localhost:5173, proxies /api
```

After changing a domain type, run `cargo test` to regenerate the TypeScript types and commit them. CI fails if they drift.

## Extending

- A new charge is data: a `Charge` for a catalog office or a local one.
- A new edition or supplement updates the catalog JSON. `cargo test` validates it.
- A new kind of work is a new `Module` variant with its own module in `crates/domain`, routes in `crates/server` and a view in `web`. Responsibilities point at the module that carries them out.
