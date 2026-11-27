FROM oven/bun:1 AS web
WORKDIR /src
COPY web web
WORKDIR /src/web
RUN bun install --frozen-lockfile && bun run typecheck && bun run build

FROM rust:1-slim-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY crates crates
RUN cargo build --release -p server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=server /src/target/release/server /usr/local/bin/mayordomo
COPY --from=web /src/web/dist /app/web
ENV API_ADDR=0.0.0.0:8080 \
    WEB_DIR=/app/web \
    SETUP_FILE=/data/setup.json \
    DATABASE_URL=sqlite:///data/mayordomo.db
VOLUME /data
EXPOSE 8080
CMD ["mayordomo"]
