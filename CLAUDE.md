# CLAUDE.md

## Project
Converts Bambu Studio filament presets and `.3mf` projects so they work in Snapmaker Orca
for the Snapmaker U1. The owner prints on a Bambu Lab P1S and a Snapmaker U1, and slices
for the U1 with Snapmaker Orca.

Everything runs in the browser: files are never uploaded, the server only serves one HTML
page. The README describes all features. The 3MF conversion is based on
[josuanbn/bl2u1](https://github.com/josuanbn/bl2u1).

## Stack
- Plain JS: `src/core.js` (presets), `src/threemf.js` (3mf), `src/page.html` (UI).
- `npm run build` (`build.js`) bundles it into `dist/`; `npm test` runs `test/run.js`.
- `tools/update-presets.py` rebuilds `data/presets.json.gz` from the latest Bambu Studio and
  Snapmaker Orca releases. A weekly GitHub Action (`update-presets.yml`) runs it and opens a
  pull request when the data changed.
- Every push to `main` builds and publishes `ghcr.io/kitkat0981/u1-converter:latest`
  (`docker.yml`): nginx serving the bundle, mapped to port 8765 in `docker-compose.yml`.
- Self-hosted on a home CasaOS (Ubuntu) server that pulls the image from GHCR. That server runs
  one shared Watchtower that updates containers labelled
  `com.centurylinklabs.watchtower.enable=true` (the label in `docker-compose.yml`). Never add a
  Watchtower service to `docker-compose.yml`: Watchtower removes other Watchtowers, so two of
  them delete each other.
- The server's copy of `docker-compose.yml` is a separate file, not a git checkout: a merged
  change to it does not reach the server. When a PR changes it, give the owner the manual edit.

## Rules
- Always open a pull request for any code change. Never push or merge to `main`.
- Open pull requests ready for review, never as drafts: the owner only clicks Merge and Confirm.
- The repo is public: never commit anything personal (names, emails, IPs, server
  addresses, tokens, the owner's own filament files).
- Run `npm test` before opening a pull request.
