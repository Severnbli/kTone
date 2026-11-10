# syntax=docker/dockerfile:1

# --- dev: Node + pnpm + Rust (wasm32 target) + wasm-bindgen CLI -------------
FROM node:22.11.0-bookworm AS dev

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
      --profile minimal --default-toolchain 1.90.0 \
      --component rustfmt,clippy --target wasm32-unknown-unknown \
 && cargo install wasm-bindgen-cli --version 0.2.100 --locked \
 && rm -rf /usr/local/cargo/registry \
 && npm install -g pnpm@9.15.0 \
 && mkdir -p /usr/local/cargo/registry /home/node/.local/share/pnpm/store /work \
 && chown -R node:node /usr/local/cargo /usr/local/rustup /home/node /work

USER node
WORKDIR /work

# --- build: compile the WASM core and the static web app --------------------
FROM dev AS build

COPY --chown=node:node web/package.json web/pnpm-lock.yaml web/
RUN pnpm -C web install --frozen-lockfile

COPY --chown=node:node Cargo.toml Cargo.lock ./
COPY --chown=node:node core core
COPY --chown=node:node wasm wasm
COPY --chown=node:node scripts scripts
COPY --chown=node:node web web
# Public origin for canonical links, Open Graph, robots.txt and sitemap.xml
# (default https://ktone.severnbli.dev, see web/seo/site.ts).
ARG VITE_SITE_URL
# Commit shown as the build in the settings "About" section ("dev" when unset).
ARG VITE_GIT_SHA
RUN ./scripts/build-wasm.sh && pnpm -C web build

# --- runtime: static files served by nginx ----------------------------------
FROM nginx:1.27.3-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /work/web/dist /usr/share/nginx/html

EXPOSE 80
