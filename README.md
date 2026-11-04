# U1 Converter

Convert **Bambu Studio** filament presets and **.3mf projects** so they work in **Snapmaker Orca** for the **Snapmaker U1**.

Everything runs in the browser: files you drop in are never uploaded. The server only serves one HTML page.

## What it does

### Filament presets
Drop a Bambu Studio export (*File → Export → Export Preset Bundle*: `.bbsflmt`, `.zip` or `.json`).

- Finds what you actually changed in each preset by comparing it with its Bambu parent.
- Applies those changes on top of the closest U1 system preset (Generic PLA, PETG HF, Snapmaker PLA Matte…).
- Maps Bambu's *standard / high-flow* hotend values onto the U1's.
- Always keeps material properties (vendor, cost, density, temperature range).
- Leaves out Bambu-only settings, Bambu G-code, AMS/cutter settings and pressure advance, and lists what it left out.
- Every result can be edited, and any Snapmaker Orca filament setting can be overridden.

Import the downloaded `.zip` in Snapmaker Orca with *File → Import → Import Configs*.

### 3MF projects
Drop a Bambu Studio or MakerWorld `.3mf` project.

- Replaces the Bambu printer, process and filaments with U1 ones.
- Choose which of the U1's 4 slots each Bambu colour uses. Projects with more than 4 colours can be merged.
- Rewrites painted triangles, per-part filaments, layer ranges and colour changes to match the new slots.
- Keeps model-related process changes (walls, infill, supports…) and drops printer-specific ones (speeds, accelerations, G-code).
- Fixes values Snapmaker Orca rejects, e.g. `tree_support_wall_count = -1` or `ensure_vertical_shell_thickness = enabled`.
- Centres each plate on the larger U1 bed and keeps the prime tower on the bed.
- Removes the embedded Bambu presets (the "customized presets — check the G-code" warning) and old Bambu G-code.

Open the downloaded `name-U1.3mf` in Snapmaker Orca.

## Self-host (CasaOS / Docker)

Every push to `main` builds `ghcr.io/kitkat0981/u1-converter:latest` (amd64 + arm64).

**CasaOS:** *+ → Install a customized app → Import*, paste [`docker-compose.yml`](docker-compose.yml), then *Install*.
The app runs on port `8765`.

**Plain Docker:**
```sh
docker run -d --name u1-converter --restart unless-stopped -p 8765:80 ghcr.io/kitkat0981/u1-converter:latest
```

**Update:** pull the new image (CasaOS: app settings → *Update*), or let Watchtower do it.

### Install as an app (Windows, macOS, Android)
Browsers only offer installing over **HTTPS**. Put it behind your reverse proxy (Pangolin, Caddy, Nginx Proxy Manager…), open the
HTTPS address in Edge or Chrome, then choose *Install*. The installed app works offline and can open `.3mf` files from
the file manager (*Open with → U1 Converter*).

## Develop

```sh
npm install
npm test          # synthetic fixtures: filament conversion, 3mf conversion, paint encoding
npm run build     # dist/ (self-hosted: page + manifest + service worker)
node build.js --embedded   # dist-embedded/index.html (single file)
```

| Path | |
|---|---|
| `src/page.html` | UI |
| `src/core.js` | filament preset conversion |
| `src/threemf.js` | 3mf project conversion |
| `data/presets.json.gz` | Bambu and U1 profiles, Snapmaker Orca option rules, base project template |
| `tools/update-presets.py` | refreshes `data/presets.json.gz` from upstream |

### Refreshing the preset data
When Bambu or Snapmaker publish new profiles:
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
