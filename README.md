<p align="center">
  <img src="assets/brand/banner-readme.png" alt="kTone" width="600">
</p>

<p align="center"><b>A smart pitch detector for people learning to sing.</b></p>

<p align="center"><a href="https://ktone.severnbli.dev"><b>Try it at ktone.severnbli.dev</b></a></p>

kTone listens to your voice and shows in real time which note you are singing, how many cents you are off, and whether you hit the target. Unlike a plain tuner it understands music notation: notes are spelled according to the selected key (F♯ in D major, G♭ in D♭ major), shown as scale degrees, and drawn on a staff in the selected clef.

## Features (MVP)

- Real-time note, frequency and cents deviation with green / yellow / red hit zones
- Key-aware spelling for all 30 major and minor keys, scale degrees, out-of-key highlighting
- Staff in treble, treble 8vb, bass, alto and tenor clefs
- Pitch curve for the last few seconds
- Drone on the tonic
- Solfège with Russian octave names or letter names (C4), configurable A4

## Self-hosting

kTone is a static web app served by nginx on port 80 inside the container. Images on Docker Hub:

- `severnbli/ktone:latest` – stable, built from `main`
- `severnbli/ktone:dev` – the integration branch, updated on every merge
- `severnbli/ktone:<branch>-<sha>` – a specific build

### Docker Compose

Save as `compose.yaml` and run `docker compose up -d`:

```yaml
services:
  ktone:
    image: severnbli/ktone:latest
    restart: unless-stopped
    ports:
      - "8080:80"
```

Update to a newer image with `docker compose pull && docker compose up -d`.

### docker run

```sh
docker run -d --name ktone --restart unless-stopped -p 8080:80 severnbli/ktone:latest
```

Either way the app is on http://localhost:8080. Browsers allow microphone access only on `localhost` or over HTTPS, so for any other host put it behind a reverse proxy with TLS (Caddy, Traefik, nginx) that forwards to port 8080.

## Development

Requires Docker with Compose.

```sh
docker compose up web                    # dev server on http://localhost:5173
docker compose run --rm dev cargo test --workspace
docker compose --profile prod up app     # production image on http://localhost:8080
```

The microphone works only on `localhost` or over HTTPS.

## Project layout

```
core/     Rust: pitch detection (MPM) and music theory
wasm/     WebAssembly bindings for the core
web/      React + TypeScript PWA
scripts/  build helpers (WASM build, icon generation)
assets/   brand sources
docs/     decision log
```

## Contributing

Rules for humans and AI agents live in [AGENTS.md](AGENTS.md).

## License

[GPL-3.0](LICENSE)
