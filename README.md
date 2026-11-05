# U1 Converter

Convert **Bambu Studio** filament presets and **.3mf projects** so they work in **Snapmaker Orca** for the **Snapmaker U1**.

Everything runs in the browser: files you drop in are never uploaded. The server only serves one HTML page.

## What it does

### Filament presets
**Your own Bambu presets.** Drop a Bambu Studio export (*File → Export → Export Preset Bundle*: `.bbsflmt`, `.zip` or `.json`).

- Finds what you actually changed in each preset by comparing it with its Bambu parent.
- Applies those changes on top of the closest U1 system preset (Generic PLA, PETG HF, Snapmaker PLA Matte…).
- Maps Bambu's *standard / high-flow* hotend values onto the U1's.
- Always keeps material properties (vendor, cost, density, temperature range).
- Leaves out Bambu-only settings, Bambu G-code, AMS/cutter settings and pressure advance, and lists what it left out.
- Every result can be edited, and any Snapmaker Orca filament setting can be overridden.

**Filament libraries.** Pick ready-made filaments from:
- Bambu Studio's library: all Bambu Lab filaments, plus Polymaker, eSUN and Overture.
- The OrcaSlicer filament library that Snapmaker Orca ships but hides for the U1: SUNLU, Polymaker/Panchroma, eSUN, Overture, Valment and others.

Each one keeps what makes it different from its source's generic filament of the same kind (temperatures, fans, density, flow), applied to the U1's matching generic preset. Max volumetric speed is scaled by the same ratio instead of copied.

Import the downloaded `.zip` in Snapmaker Orca with *File → Import → Import Configs*.

### 3MF projects
Drop one or more Bambu Studio or MakerWorld `.3mf` projects.

- Replaces the Bambu printer, process and filaments with U1 ones.
- Maps colours onto the four spools loaded in your U1 (see *My U1*): same material first, then the closest colour. You can also choose the slots by hand, and merge projects with more than 4 colours.
- Rewrites painted triangles, per-part filaments, layer ranges and colour changes to match the new slots.
- Keeps model-related process changes (walls, infill, supports…) and drops printer-specific ones (speeds, accelerations, G-code).
- Fixes values Snapmaker Orca rejects, e.g. `tree_support_wall_count = -1` or `ensure_vertical_shell_thickness = enabled`.
- Measures the models and centres each plate on the U1 bed. It warns when a plate doesn't fit or comes within 3.5 mm of the edge, and moves the prime tower clear of the models.
- Removes the embedded Bambu presets (the "customized presets — check the G-code" warning) and old Bambu G-code.
- **3D preview** of each plate in the U1 slot colours, on the U1 bed.
- **Batch:** convert several projects at once into one `.zip`.

### My U1
Kept in the browser (export/import as a backup file):
- your converted filaments, ready to re-download for Snapmaker Orca;
- the filament loaded in each toolhead T1–T4, used to map 3mf colours automatically;
- nozzle size and hotend type.

### Calibrate
A step-by-step guide to Snapmaker Orca's *Calibration* menu (temperature, max flowrate, pressure advance, flow ratio, retraction), with calculators for each test. Enter the results per filament type and download updated presets to re-import.

### Keeping up to date
Every Monday a GitHub Action rebuilds the preset data from the latest **Bambu Studio** and **Snapmaker Orca** releases. If anything changed and the tests pass, it opens a pull request with the new data. Merging it publishes a new image.

GitHub pauses scheduled workflows in repositories with no activity for 60 days. Re-enable it under *Actions → Update preset data*, or run it by hand there.

## Snapmaker Orca version

Built for **Snapmaker Orca 2.4.x**. The U1 preset names are taken from the latest Snapmaker Orca release,
so converted presets and projects refer to presets your installation already has. Older versions (2.3.x) use
different names: Snapmaker Orca would then show a "customized presets" warning, and filament imports may be skipped.

## Self-host (Docker on Ubuntu)

Every push to `main` builds `ghcr.io/kitkat0981/u1-converter:latest` (amd64 + arm64).
It is a small nginx container serving one page, so it needs no volumes, database or settings.

**1. Install Docker** (skip if it is already installed):
```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in afterwards
```

**2. Run it with Docker Compose:**
```sh
mkdir -p ~/u1-converter && cd ~/u1-converter
curl -fsSLO https://raw.githubusercontent.com/kitkat0981/u1-converter/main/docker-compose.yml
docker compose up -d
```
The app is then at `http://<server-ip>:8765`. To use another port, change `8765` in `docker-compose.yml`.

Or without Compose:
```sh
docker run -d --name u1-converter --restart unless-stopped -p 8765:80 ghcr.io/kitkat0981/u1-converter:latest
```

**Update:**
```sh
cd ~/u1-converter && docker compose pull && docker compose up -d
```
Or update automatically with [Watchtower](https://containrrr.dev/watchtower/), e.g. once a day:
```sh
docker run -d --name watchtower --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower --schedule "0 0 4 * * *" --cleanup u1-converter
```

**Remove:** `docker compose down` in the same folder.

### Install as an app (Windows, macOS, Android)
Browsers only offer installing over **HTTPS**. Put it behind your reverse proxy (Pangolin, Caddy, Nginx Proxy Manager…), open the
HTTPS address in Edge or Chrome, then choose *Install*. The installed app works offline and can open `.3mf` files from
the file manager (*Open with → U1 Converter*).

## Develop

```sh
npm install
npm test          # synthetic fixtures: filaments, libraries, calibration, 3mf conversion, paint, preview
npm run build     # dist/ (self-hosted: page + manifest + service worker)
node build.js --embedded   # dist-embedded/index.html (single file)
```

| Path | |
|---|---|
| `src/page.html` | UI |
| `src/core.js` | filament preset conversion |
| `src/threemf.js` | 3mf project conversion, bed fit, 3D preview mesh |
| `data/presets.json.gz` | Bambu and U1 profiles, OrcaSlicer filament library, Snapmaker Orca option rules, base project template |
| `tools/update-presets.py` | refreshes `data/presets.json.gz` from upstream |

### Refreshing the preset data
Done automatically every week (see above). To do it by hand:
```sh
python3 tools/update-presets.py && npm test
git commit -am "Update preset data" && git push
```

## Limits

- Flow ratio, pressure advance and max volumetric speed come from a different hotend: re-run the calibrations on the U1.
- Objects larger than the U1 bed are flagged, not resized. Use *Arrange* in Snapmaker Orca.
- Painted triangles that use an unknown encoding keep their original filament numbers and are reported.

## Licence

GPL-3.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). 3mf conversion is based on the approach of
[bl2u1](https://github.com/josuanbn/bl2u1) by josuanbn.
