# Mayordomo

A workspace for the duties a church officer holds. Each duty, such as first elder for a church year, enables the modules that duty needs. The first module is the board meeting agenda. When a duty changes, the duty list changes. The app does not.

## Layout

- `crates/domain` holds the types: `Duty`, `Module` and the agenda's `Meeting` and `AgendaItem`. It is the single source of truth for every shape.
- `crates/server` is the HTTP API (axum), under `/api`.
- `web` is the Bun and TypeScript front end. `web/src/generated` is exported from `crates/domain` by `cargo test`. Never edit it by hand.

## Develop

```sh
cargo run -p server          # API on 127.0.0.1:3000
cd web && bun install && bun run dev   # web on localhost:5173, proxies /api
```

After changing a domain type, run `cargo test` to regenerate the TypeScript types and commit them. CI fails if they drift.

## Adding a duty or a module

A new duty is data: a `Duty` with its term and the modules it enables. A new kind of work is a new `Module` variant with its own module in `crates/domain`, routes in `crates/server`, and a view in `web`.
