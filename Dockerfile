# Development image: Node + pnpm + Rust (wasm32 target) + wasm-bindgen CLI.
FROM node:22.11.0-bookworm

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
