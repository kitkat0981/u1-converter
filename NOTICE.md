# Notices

- The 3MF project conversion follows the approach of **bl2u1** by josuanbn
  (https://github.com/josuanbn/bl2u1, GPL-3.0). Its U1 project template
  (`u1_template.3mf` → `project_settings.config`) is embedded in `data/presets.json.gz`
  as the base for converted projects.
- `data/presets.json.gz` also contains:
  - Bambu Studio filament profiles from https://github.com/bambulab/BambuStudio (AGPL-3.0)
  - Snapmaker U1 filament, process and printer profiles from https://github.com/Snapmaker/snapmaker-profiles
  - option lists, value ranges and enum values extracted from https://github.com/Snapmaker/OrcaSlicer (AGPL-3.0)
- JSZip (https://github.com/Stuk/jszip, MIT or GPL-3.0) is bundled into the built page.

Exact upstream commits are recorded in the `meta` field of `data/presets.json.gz` and shown in the page footer.
