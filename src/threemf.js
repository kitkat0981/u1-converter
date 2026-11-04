/* Bambu Studio .3mf project -> Snapmaker U1 (Snapmaker Orca) project converter.
 * Approach inspired by bl2u1 by josuanbn (https://github.com/josuanbn/bl2u1, GPL-3.0); this file is GPL-3.0 too.
 * Pure logic: takes a JSZip instance in, returns a JSZip instance out. */
(function (root) {
  'use strict';
  const core = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.B2U;
  const { makeLib, resolve } = core;

  const SLOTS = 4;
  const META = new Set(['name', 'inherits', 'from', 'instantiation', 'setting_id', 'type', 'version', 'renamed_from',
    'include', 'description', 'printer_settings_id', 'print_settings_id', 'filament_settings_id', 'is_custom_defined', 'filament_id', 'base_id']);
  // Bambu process changes we never carry: they depend on the printer, not the model.
  const PROC_EXCLUDE = /speed|accel|jerk|gcode|wipe_tower|prime_tower|flush|purge|travel|timelapse|ooze|z_hop|retract|nozzle|printer|chamber|fan|cooling|wiping|_settings_id|compatible|inherits|post_process|filename|exclude_object|^bed_|max_volumetric|smooth_coefficient|machine_|extruder_clearance|print_flow_ratio|counter_|hole_|circle_compensation/;
  const FEATURE_FILAMENT_KEYS = ['support_filament', 'support_interface_filament', 'wall_filament', 'sparse_infill_filament', 'solid_infill_filament', 'wipe_tower_filament'];
  // Bambu enum spellings that Snapmaker Orca names differently
  const ENUM_FIX = {
    ensure_vertical_shell_thickness: { enabled: 'ensure_all', disabled: 'none', partial: 'ensure_moderate' },
  };
  const DROP_FILES = [/^Metadata\/plate_\d+\.gcode(\.md5)?$/i, /^Metadata\/plate_\d+\.json$/i, /^Metadata\/filament_sequence\.json$/i,
    /^Metadata\/print_setting_\d+\.config$/i, /^Metadata\/filament_settings_\d+\.config$/i, /^Metadata\/machine_settings_\d+\.config$/i,
    /^Metadata\/process_settings_\d+\.config$/i, /^Metadata\/slice_info\.config$/i, /^Metadata\/.*\.gcode$/i];

  const first = v => Array.isArray(v) ? v[0] : v;
  const arr = v => Array.isArray(v) ? v : (v === undefined ? undefined : [v]);
  const clone = o => JSON.parse(JSON.stringify(o));
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // ---------- multi-material paint (TriangleSelector bitstream, hex, read from the end) ----------
  const HEX = '0123456789ABCDEF';
  function remapPaint(s, mapState) {
    let pos = s.length - 1;
    const out = [];
    const nib = () => {
      if (pos < 0) throw new Error('eof');
      const c = s.charCodeAt(pos--);
      if (c >= 48 && c <= 57) return c - 48;
      if (c >= 65 && c <= 70) return c - 55;
      if (c >= 97 && c <= 102) return c - 87;
      throw new Error('bad hex');
    };
    const emit = st => {
      if (st < 3) out.push(st << 2);
      else { out.push(12); let v = st - 3; while (v >= 15) { out.push(15); v -= 15; } out.push(v); }
    };
    const node = () => {
      const code = nib();
      const split = code & 3;
      if (split) { out.push(code); for (let i = 0; i <= split; i++) node(); return; }
      let st;
      if ((code & 12) === 12) { let nx = nib(), num = 0; while (nx === 15) { num++; nx = nib(); } st = nx + 15 * num + 3; }
      else st = code >> 2;
      emit(mapState(st));
    };
    node();
    while (pos >= 0) { // trailing nibbles beyond the tree must be zero padding
      if (nib() !== 0) throw new Error('trailing data');
    }
    let r = '';
    for (let i = out.length - 1; i >= 0; i--) r += HEX[out[i]];
    return r;
  }
  function paintStates(s, set) {
    remapPaint(s, st => { if (st) set.add(st); return st; });
  }
  // Dominant filament state of a painted triangle (leaves weighted by their share of the triangle).
  function paintDominant(s) {
    let pos = s.length - 1;
    const w = {};
    const nib = () => { const c = s.charCodeAt(pos--); return c <= 57 ? c - 48 : (c <= 70 ? c - 55 : c - 87); };
    const node = weight => {
      const code = nib(), split = code & 3;
      if (split) { for (let i = 0; i <= split; i++) node(weight / (split + 1)); return; }
      let st;
      if ((code & 12) === 12) { let nx = nib(), num = 0; while (nx === 15) { num++; nx = nib(); } st = nx + 15 * num + 3; } else st = code >> 2;
      w[st] = (w[st] || 0) + weight;
    };
    try { node(1); } catch (e) { return 0; }
    let best = 0, bw = -1;
    for (const k in w) if (w[k] > bw) { bw = w[k]; best = +k; }
    return best;
  }

  // 3MF uses row vectors: p' = p · M, transform="m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"
  const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const parseT = t => { const a = String(t || '').trim().split(/\s+/).map(Number); return a.length === 12 && !a.some(isNaN) ? a : IDENT.slice(); };
  function mul(a, b) { // apply a then b
    const r = new Array(12);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const ai = i * 3;
      r[ai + j] = (i < 3 ? 0 : b[9 + j]) + a[ai] * b[j] + a[ai + 1] * b[3 + j] + a[ai + 2] * b[6 + j];
    }
    return r;
  }
  function parseMeshes(text, withTris) {
    const out = {};
    for (const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = (/\bid="(\d+)"/.exec(m[1]) || [])[1];
      const body = m[2];
      const comps = [...body.matchAll(/<component\b([^>]*)\/?>/g)].map(c => ({
        path: ((/(?:p:)?path="([^"]*)"/.exec(c[1]) || [])[1] || '').replace(/^\//, ''),
        objectid: (/objectid="(\d+)"/.exec(c[1]) || [])[1], transform: parseT((/transform="([^"]*)"/.exec(c[1]) || [])[1]),
      }));
      let mesh = null;
      const vi = body.indexOf('<vertices');
      if (vi >= 0) {
        const vs = [];
        for (const v of body.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)) vs.push(+v[1], +v[2], +v[3]);
        mesh = { verts: Float32Array.from(vs) };
        if (withTris) {
          const ts = [], paint = [];
          let anyPaint = false;
          for (const t of body.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"([^>]*)>/g)) {
            ts.push(+t[1], +t[2], +t[3]);
            const pc = (/paint_color="([0-9A-Fa-f]+)"/.exec(t[4]) || [])[1];
            paint.push(pc || null); if (pc) anyPaint = true;
          }
          mesh.tris = Uint32Array.from(ts);
          mesh.paint = anyPaint ? paint : null;
        }
      }
      out[id] = { comps, mesh };
    }
    return out;
  }

  // ---------- plates ----------
  function colCount(n) { const v = Math.sqrt(n), r = Math.round(v); return v > r ? r + 1 : r; }
  function bedBox(area) {
    const pts = (area || ['0x0', '256x0', '256x256', '0x256']).map(p => String(p).split('x').map(Number));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, w: maxX - minX, d: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  function plateOrigin(i, cols, bed) {
    const row = Math.floor(i / cols), col = i % cols;
    return { x: col * bed.w * 1.2, y: -row * bed.d * 1.2 };
  }

  function Converter3MF(data, conv) {
    this.conv = conv;
    this.sm = conv.sm;
    this.bbl = conv.bbl;
    this.proc = makeLib(data.smProc);
    this.mach = makeLib(data.smMach);
    this.defs = data.defs;
    this.printKeys = new Set(data.printKeys);
    this.printerKeys = new Set(data.printerKeys);
    this.filKeys = conv.smKeys;
    this.tpl = data.tpl;
    this.procNames = Object.keys(data.smProc).filter(n => /@Snapmaker U1 \(\d\.\d nozzle\)$/.test(n) && data.smProc[n].instantiation === 'true')
      .sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
    this.filVariantKeys = new Set(['filament_flow_ratio', 'enable_pressure_advance', 'pressure_advance', 'nozzle_temperature_initial_layer',
      'nozzle_temperature', 'filament_max_volumetric_speed', 'fan_min_speed', 'fan_max_speed', 'additional_cooling_fan_speed',
      'filament_retraction_length', 'filament_retraction_speed', 'filament_deretraction_speed', 'filament_z_hop_types',
      'filament_wipe_distance', 'filament_retract_length_toolchange', 'filament_multitool_ramming', 'filament_multitool_ramming_volume',
      'filament_multitool_ramming_flow', 'filament_minimal_purge_on_wipe_tower', 'filament_flow_support']);
  }
  const P = Converter3MF.prototype;

  P.processesFor = function (nozzle) { return this.procNames.filter(n => n.includes(`(${nozzle} nozzle)`)); };

  // Check one value against Snapmaker Orca's option definition. Returns {value, changed, invalid, note}
  P.validate = function (key, value) {
    const d = this.defs[key];
    if (!d || value === undefined) return { value };
    const isArr = Array.isArray(value);
    const vals = isArr ? value.slice() : [value];
    let changed = false, invalid = false, note = '';
    if (/^co(Int|Float|Percent|FloatOrPercent)s?$/.test(d.t) || /^coPercents?$/.test(d.t)) {
      for (let i = 0; i < vals.length; i++) {
        const raw = String(vals[i]);
        if (raw === 'nil' || raw === '') continue;
        const pct = raw.endsWith('%');
        const n = parseFloat(raw);
        if (isNaN(n)) continue;
        if (pct && d.t.startsWith('coFloatOrPercent')) continue;
        let m = n;
        if (d.min !== undefined && m < d.min) m = d.min;
        if (d.max !== undefined && m > d.max) m = d.max;
        if (m !== n) { vals[i] = (Number.isInteger(m) ? String(m) : String(+m.toFixed(6))) + (pct ? '%' : ''); changed = true; note = `${raw} is outside ${d.min ?? '−∞'}…${d.max ?? '∞'}`; }
      }
    } else if (/^coEnums?$/.test(d.t) && d.enum && d.enum.length) {
      for (let i = 0; i < vals.length; i++) {
        const v = String(vals[i]);
        if (v === 'nil' || d.enum.includes(v)) continue;
        const fix = ENUM_FIX[key] && ENUM_FIX[key][v];
        if (fix) { vals[i] = fix; changed = true; note = `"${v}" is spelled "${fix}" in Snapmaker Orca`; }
        else { invalid = true; note = `"${v}" is not a valid option`; }
      }
    }
    return { value: isArr ? vals : vals[0], changed, invalid, note };
  };

  /** Parse meshes. withTris=false gives just vertices (for bounding boxes). Cached per zip. */
  P.geometry = async function (zip, withTris) {
    this._geo = this._geo || new WeakMap();
    const c = this._geo.get(zip);
    if (c && (c.withTris || !withTris)) return c;
    const files = {};
    const load = async name => { if (!(name in files)) { const f = zip.file(name); files[name] = f ? parseMeshes(await f.async('string'), withTris) : {}; } return files[name]; };
    const root = await load('3D/3dmodel.model');
    const model = await zip.file('3D/3dmodel.model').async('string');
    const items = [...model.matchAll(/<item\b([^>]*)\/?>/g)].map(m => ({ objectid: (/objectid="(\d+)"/.exec(m[1]) || [])[1], transform: parseT((/transform="([^"]*)"/.exec(m[1]) || [])[1]) }));
    const objects = {};
    for (const [id, o] of Object.entries(root)) {
      const parts = [];
      if (o.mesh) parts.push({ partId: id, transform: IDENT.slice(), mesh: o.mesh });
      for (const c of o.comps) {
        const sub = c.path ? await load(c.path) : root;
        const so = sub[c.objectid];
        if (so && so.mesh) parts.push({ partId: c.objectid, transform: c.transform, mesh: so.mesh });
      }
      objects[id] = { parts };
    }
    const seen = {};
    for (const it of items) {
      it.instance = seen[it.objectid] = (seen[it.objectid] === undefined ? 0 : seen[it.objectid] + 1);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of (objects[it.objectid] || { parts: [] }).parts) {
        const M = mul(p.transform, it.transform), v = p.mesh.verts;
        for (let i = 0; i < v.length; i += 3) {
          const x = v[i] * M[0] + v[i + 1] * M[3] + v[i + 2] * M[6] + M[9];
          const y = v[i] * M[1] + v[i + 1] * M[4] + v[i + 2] * M[7] + M[10];
          const z = v[i] * M[2] + v[i + 1] * M[5] + v[i + 2] * M[8] + M[11];
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
        }
      }
      it.bbox = isFinite(minX) ? { minX, minY, maxX, maxY, maxZ } : null;
    }
    const g = { items, objects, withTris: !!withTris };
    this._geo.set(zip, g);
    return g;
  };

  /** Where each plate's contents go on the U1 bed: shift (plate-local mm) that centres them. */
  P.plateShifts = function (info, geo) {
    const srcBed = info.bed, dstBed = this.dstBed(info);
    const cols = colCount(info.plates), out = [];
    for (let i = 0; i < info.plates; i++) out.push({ dx: dstBed.cx - srcBed.cx, dy: dstBed.cy - srcBed.cy, fromMesh: false });
    if (!geo) return out;
    const boxes = {};
    for (const it of geo.items) {
      if (!it.bbox) continue;
      const plate = info.plateOf[`${it.objectid}:${it.instance}`] ?? 0;
      const o = plateOrigin(plate, cols, srcBed);
      const b = boxes[plate] = boxes[plate] || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      b.minX = Math.min(b.minX, it.bbox.minX - o.x); b.maxX = Math.max(b.maxX, it.bbox.maxX - o.x);
      b.minY = Math.min(b.minY, it.bbox.minY - o.y); b.maxY = Math.max(b.maxY, it.bbox.maxY - o.y);
    }
    for (const [p, b] of Object.entries(boxes)) {
      if (!out[p]) continue;
      out[p] = { dx: dstBed.cx - (b.minX + b.maxX) / 2, dy: dstBed.cy - (b.minY + b.maxY) / 2, fromMesh: true, w: b.maxX - b.minX, d: b.maxY - b.minY,
        box: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } };
    }
    return out;
  };
  P.dstBed = function (info) {
    return bedBox(arr(resolve(this.mach, `Snapmaker U1 (${(info && info.nozzle) || '0.4'} nozzle)`).printable_area));
  };

  const typeFamily = t => String(t || 'PLA').toUpperCase().split(/[-\s]/)[0];
  const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const colourDist = (a, b) => { const x = rgb(a), y = rgb(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
  P.presetType = function (preset, customs) {
    if (preset && preset.kind === 'custom' && customs && customs[preset.name]) return first(Object.assign({}, resolve(this.sm, customs[preset.name].inherits), customs[preset.name]).filament_type);
    return first(resolve(this.sm, preset && preset.name).filament_type);
  };
  /** Map Bambu filaments onto the spools loaded in the U1: same material first, then closest colour. */
  P.mapToSpools = function (info, spools, customs) {
    const types = spools.map(s => typeFamily(this.presetType(s.preset, customs)));
    const map = {};
    for (const f of info.filaments) {
      let best = 1, bs = Infinity;
      spools.forEach((s, i) => {
        const score = colourDist(f.colour, s.colour) + (types[i] === typeFamily(f.type) ? 0 : 1e6);
        if (score < bs) { bs = score; best = i + 1; }
      });
      map[f.idx] = best;
    }
    return map;
  };

  /** Read a Bambu 3mf and describe it. */
  P.inspect = async function (zip) {
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    const read = async n => zip.file(n) ? await zip.file(n).async('string') : null;
    const cfgText = await read('Metadata/project_settings.config');
    if (!cfgText) throw new Error('This 3mf has no project settings (Metadata/project_settings.config). It is a plain model file — open it directly in Snapmaker Orca instead.');
    const cfg = JSON.parse(cfgText.replace(/^﻿/, ''));
    const modelText = await read('3D/3dmodel.model') || '';
    const msText = await read('Metadata/model_settings.config') || '';
    const app = (/<metadata name="Application">([^<]*)</.exec(modelText) || [])[1] || '';
    const modelFiles = names.filter(n => /^3D\/.*\.model$/i.test(n));

    // filaments in the source
    const colours = arr(cfg.filament_colour) || ['#FFFFFF'];
    const nFil = colours.length;
    const filaments = colours.map((c, i) => ({
      idx: i + 1, colour: String(c).slice(0, 7).toUpperCase(),
      type: String((arr(cfg.filament_type) || [])[i] || 'PLA'),
      settingsId: String((arr(cfg.filament_settings_id) || [])[i] || ''),
      vendor: String((arr(cfg.filament_vendor) || [])[i] || ''),
      uses: { parts: 0, paint: 0, other: 0 },
    }));
    const bump = (idx, kind) => { const f = filaments[idx - 1]; if (f) f.uses[kind]++; };

    // part / object extruders
    for (const m of msText.matchAll(/key="extruder" value="(\d+)"/g)) bump(+m[1], 'parts');
    for (const m of msText.matchAll(/opt_key="extruder">\s*(\d+)/g)) bump(+m[1], 'other');
    // painted triangles
    let paintedTris = 0, paintErrors = 0;
    for (const f of modelFiles) {
      const t = await read(f);
      if (!t || t.indexOf('paint_color') < 0) continue;
      for (const m of t.matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) {
        paintedTris++;
        const set = new Set();
        try { paintStates(m[1], set); } catch (e) { paintErrors++; }
        for (const s of set) bump(s, 'paint');
      }
    }
    const cgText = await read('Metadata/custom_gcode_per_layer.xml');
    if (cgText) for (const m of cgText.matchAll(/extruder="(\d+)"/g)) bump(+m[1], 'other');
    for (const k of FEATURE_FILAMENT_KEYS) { const v = +first(cfg[k]); if (v > 0) bump(v, 'other'); }
    if (!filaments.some(f => f.uses.parts + f.uses.paint + f.uses.other)) filaments[0].uses.parts = 1;
    filaments.forEach(f => f.used = (f.uses.parts + f.uses.paint + f.uses.other) > 0);

    const plates = [...msText.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].length || 1;
    const plateOf = {};
    let pIdx = 0;
    for (const m of msText.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const id = +((/key="plater_id" value="(\d+)"/.exec(m[1]) || [])[1] || (pIdx + 1));
      for (const inst of m[1].matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
        const o = (/key="object_id" value="(\d+)"/.exec(inst[1]) || [])[1];
        const i = (/key="instance_id" value="(\d+)"/.exec(inst[1]) || [])[1] || '0';
        if (o) plateOf[`${o}:${i}`] = id - 1;
      }
      pIdx++;
    }
    const extruders = {};
    for (const m of msText.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)) {
      const head = m[2].split('<part')[0];
      const e = { ext: +((/key="extruder" value="(\d+)"/.exec(head) || [])[1] || 1), parts: {} };
      for (const p of m[2].matchAll(/<part id="(\d+)"[^>]*>([\s\S]*?)<\/part>/g)) {
        const pe = (/key="extruder" value="(\d+)"/.exec(p[2]) || [])[1];
        if (pe) e.parts[p[1]] = +pe;
      }
      extruders[m[1]] = e;
    }
    const nozzle = String(first(cfg.nozzle_diameter) || '0.4');
    const layerHeight = parseFloat(cfg.layer_height) || 0.2;
    const embedded = names.filter(n => /^Metadata\/(print_setting|filament_settings|machine_settings|process_settings)_\d+\.config$/i.test(n));
    const gcodeFiles = names.filter(n => /^Metadata\/.*\.gcode$/i.test(n));
    const diffs = String((arr(cfg.different_settings_to_system) || [''])[0] || '').split(';').filter(Boolean);
    return {
      cfg, app, isBambu: /^BambuStudio/i.test(app) || /BBL|Bambu/.test(String(cfg.printer_settings_id || '')),
      printer: String(cfg.printer_settings_id || ''), process: String(cfg.print_settings_id || ''),
      nozzle: ['0.2', '0.4', '0.6', '0.8'].includes(nozzle) ? nozzle : '0.4', layerHeight, plates, filaments, nFil,
      paintedTris, paintErrors, embedded, gcodeFiles, processDiffs: diffs, bed: bedBox(arr(cfg.printable_area)), plateOf, extruders,
      objects: [...msText.matchAll(/<object id=/g)].length,
    };
  };

  /** Default plan: slot mapping, slot presets, process. */
  P.defaultPlan = function (info, setup, customs) {
    if (setup && Array.isArray(setup.spools) && setup.spools.length === SLOTS && setup.spools.every(s => s && s.preset)) {
      const nozzle = setup.nozzle || info.nozzle;
      const slots = setup.spools.map(s => ({ colour: s.colour, preset: Object.assign({}, s.preset), fromSetup: true }));
      const procs = this.processesFor(nozzle);
      const lh = info.layerHeight;
      const process = procs.find(n => Math.abs(parseFloat(n) - lh) < 1e-6 && /Standard/.test(n))
        || procs.filter(n => /Standard/.test(n)).sort((a, b) => Math.abs(parseFloat(a) - lh) - Math.abs(parseFloat(b) - lh))[0] || procs[0];
      return { map: this.mapToSpools(info, slots, customs), slots, nozzle, process, recenter: true, keepProcess: true, procOverrides: {}, hotend: setup.hotend || 'standard', fromSetup: true };
    }
    const used = info.filaments.filter(f => f.used);
    const map = {};
    const slots = [];
    used.slice(0, SLOTS).forEach((f, i) => { map[f.idx] = i + 1; slots.push({ colour: f.colour, from: f }); });
    const nearest = c => {
      const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
      const a = rgb(c);
      let best = 1, bd = Infinity;
      slots.forEach((s, i) => { const b = rgb(s.colour); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = i + 1; } });
      return best;
    };
    for (const f of info.filaments) if (!map[f.idx]) map[f.idx] = slots.length ? nearest(f.colour) : 1;
    while (slots.length < SLOTS) slots.push({ colour: '#FFFFFF', from: null, padding: true });
    for (const s of slots) s.preset = this.pickFilament(s.from, info.nozzle);
    const procs = this.processesFor(info.nozzle);
    const lh = info.layerHeight;
    let process = procs.filter(n => /Standard/.test(n)).sort((a, b) => Math.abs(parseFloat(a) - lh) - Math.abs(parseFloat(b) - lh))[0] || procs[0];
    const exact = procs.find(n => Math.abs(parseFloat(n) - lh) < 1e-6 && /Standard/.test(n));
    if (exact) process = exact;
    return { map, slots, nozzle: info.nozzle, process, recenter: true, keepProcess: true, procOverrides: {} };
  };

  P.pickFilament = function (f, nozzle) {
    if (!f) return { kind: 'system', name: this.conv.targetName('Generic PLA', nozzle).name };
    const chain = [f.settingsId];
    const res = { filament_type: [f.type], filament_vendor: [f.vendor] };
    const t = this.conv.pickTarget(res, chain, nozzle);
    return { kind: 'system', name: this.conv.targetName(t.base, nozzle).name };
  };

  /** Bambu process settings worth carrying (validated) */
  P.processCarry = function (info, processName) {
    const cfg = info.cfg;
    const pres = resolve(this.proc, processName);
    const out = [], skipped = [];
    const keys = new Set(info.processDiffs);
    keys.add('layer_height');
    for (const k of keys) {
      if (k === 'layer_height' && Math.abs(parseFloat(cfg.layer_height) - parseFloat(pres.layer_height)) < 1e-6) continue;
      if (!this.printKeys.has(k)) { skipped.push({ key: k, reason: 'Bambu-only setting' }); continue; }
      if (PROC_EXCLUDE.test(k)) { skipped.push({ key: k, reason: 'Printer-specific (speeds, accelerations, prime tower, G-code…) — U1 values kept' }); continue; }
      let v = cfg[k];
      if (v === undefined) continue;
      const u = pres[k] !== undefined ? pres[k] : this.tpl[k];
      if (Array.isArray(u) && !Array.isArray(v)) v = u.map(() => v);
      else if (!Array.isArray(u) && Array.isArray(v) && u !== undefined) v = v[0];
      else if (Array.isArray(u) && Array.isArray(v) && u.length !== v.length) v = u.map((_, i) => v[i] !== undefined ? v[i] : v[0]);
      const val = this.validate(k, v);
      if (val.invalid) { skipped.push({ key: k, reason: val.note + ' — U1 value kept', value: v }); continue; }
      if (FEATURE_FILAMENT_KEYS.includes(k)) val.note = val.note || 'filament number follows the slot mapping';
      if (JSON.stringify(val.value) === JSON.stringify(u)) continue;
      out.push({ key: k, bambu: cfg[k], u1: u, value: val.value, note: val.changed ? val.note : '' });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return { carry: out, skipped };
  };

  P.filamentConfig = function (preset, customs) {
    if (preset.kind === 'custom') {
      const c = customs && customs[preset.name];
      if (c) {
        const parent = resolve(this.sm, c.inherits);
        return { cfg: Object.assign({}, parent, c), name: c.name, inherits: c.inherits, id: c.filament_id || '', diff: Object.keys(c).filter(k => !META.has(k) && k !== 'compatible_printers') };
      }
    }
    const n = this.sm.byName[preset.name] ? preset.name : (this.sm.alias[preset.name] || preset.name);
    const cfg = resolve(this.sm, n);
    return { cfg, name: n, inherits: '', id: cfg.filament_id || cfg.setting_id || '', diff: [] };
  };

  /**
   * Convert. Returns { zip, report }.
   * plan: { map: {bambuIdx: slot}, slots: [{colour, preset:{kind,name}}], nozzle, process, recenter, keepProcess, procOverrides:{key:value}, hotend }
   */
  P.convert = async function (zipIn, info, plan, opts) {
    opts = opts || {};
    const JSZipCtor = opts.JSZip || (typeof JSZip !== 'undefined' ? JSZip : require('jszip'));
    const report = { fixed: [], warnings: [], removedFiles: [], carried: [], skipped: [] };
    const nozzle = plan.nozzle;
    const printerName = `Snapmaker U1 (${nozzle} nozzle)`;
    const pr = resolve(this.mach, printerName);
    const pc = resolve(this.proc, plan.process);
    const srcCfg = info.cfg;
    const slotOf = idx => +(plan.map[idx] || 1);
    const identity = info.filaments.every(f => slotOf(f.idx) === f.idx);

    // ---------- project_settings.config ----------
    const cfg = clone(this.tpl);
    for (const k of Object.keys(cfg)) if (this.filKeys.has(k) || this.filVariantKeys.has(k) || /^filament_/.test(k)) delete cfg[k];
    for (const [k, v] of Object.entries(pr)) if (!META.has(k)) cfg[k] = clone(v);
    for (const [k, v] of Object.entries(pc)) if (!META.has(k) && k !== 'compatible_printers' && k !== 'compatible_printers_condition') cfg[k] = clone(v);
    cfg.print_compatible_printers = clone(pc.compatible_printers || [printerName]);

    // carried Bambu process settings + manual overrides
    const procDiff = new Set();
    if (plan.keepProcess !== false) {
      const pcCarry = this.processCarry(info, plan.process);
      report.skipped.push(...pcCarry.skipped);
      for (const c of pcCarry.carry) {
        if (plan.procOverrides && plan.procOverrides[c.key] === null) continue; // user removed it
        cfg[c.key] = c.value; procDiff.add(c.key); report.carried.push(c);
        if (c.note && !FEATURE_FILAMENT_KEYS.includes(c.key)) report.fixed.push(`${c.key}: ${c.note} — set to ${JSON.stringify(c.value)}`);
      }
    }
    for (const [k, v] of Object.entries(plan.procOverrides || {})) {
      if (v === null || !this.printKeys.has(k)) continue;
      const val = this.validate(k, v);
      if (val.invalid) { report.warnings.push(`Override ${k}: ${val.note} — ignored`); continue; }
      cfg[k] = val.value; procDiff.add(k);
    }
    for (const k of FEATURE_FILAMENT_KEYS) {
      if (cfg[k] === undefined) continue;
      const v = +first(cfg[k]);
      if (procDiff.has(k) && v > 0) cfg[k] = Array.isArray(cfg[k]) ? [String(slotOf(v))] : String(slotOf(v));
    }

    // filaments
    const fcs = plan.slots.map(s => this.filamentConfig(s.preset, opts.customs));
    const steps = fcs.map(f => (arr(f.cfg.filament_flow_support) || ['standard']).length);
    const fkeys = new Set();
    for (const f of fcs) for (const k of Object.keys(f.cfg)) if ((this.filKeys.has(k) || this.filVariantKeys.has(k)) && !META.has(k)) fkeys.add(k);
    for (const k of ['compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'inherits', 'filament_notes']) fkeys.delete(k);
    for (const k of fkeys) {
      if (this.filVariantKeys.has(k)) {
        const out = [];
        fcs.forEach((f, i) => { const v = arr(f.cfg[k]) || ['']; for (let s = 0; s < steps[i]; s++) out.push(String(v[s] !== undefined ? v[s] : v[0])); });
        cfg[k] = out;
      } else {
        const vals = fcs.map(f => f.cfg[k]);
        if (vals.every(v => v !== undefined && !Array.isArray(v))) cfg[k] = vals[0];
        else cfg[k] = vals.map(v => String(first(v) ?? ''));
      }
    }
    cfg.filament_flow_step_size = steps.map(String);
    cfg.filament_colour = plan.slots.map(s => s.colour.toUpperCase());
    cfg.filament_settings_id = fcs.map(f => f.name);
    cfg.filament_ids = fcs.map(f => String(f.id || ''));
    cfg.filament_volume_type = plan.slots.map(() => plan.hotend === 'high_flow' ? 'high_flow' : 'standard');
    cfg.nozzle_volume_type = (arr(pr.nozzle_diameter) || [0, 0, 0, 0]).map(() => plan.hotend === 'high_flow' ? 'high_flow' : 'standard');
    cfg.filament_notes = fcs.map(() => '');

    cfg.printer_settings_id = printerName;
    cfg.print_settings_id = plan.process;
    cfg.inherits_group = ['', ...fcs.map(f => f.inherits || ''), ''];
    cfg.different_settings_to_system = [[...procDiff].sort().join(';'), ...fcs.map(f => f.diff.join(';')), ''];
    cfg.version = '2.3.0';
    cfg.from = 'project';
    cfg.name = 'project_settings';
    cfg.project_schema_version = '1';
    delete cfg.filament_map; delete cfg.filament_map_mode;

    // validate everything that came from the template (older Snapmaker Orca) or the Bambu file
    for (const k of Object.keys(cfg)) {
      const val = this.validate(k, cfg[k]);
      if (val.invalid) {
        const fallback = pc[k] !== undefined ? pc[k] : pr[k];
        if (fallback !== undefined && !this.validate(k, fallback).invalid) cfg[k] = clone(fallback); else delete cfg[k];
        if (procDiff.has(k)) report.fixed.push(`${k}: ${val.note} — reset`);
      } else if (val.changed) cfg[k] = val.value;
    }

    // ---------- plates / positions ----------
    const msName = 'Metadata/model_settings.config';
    let ms = zipIn.file(msName) ? await zipIn.file(msName).async('string') : '';
    let model = await zipIn.file('3D/3dmodel.model').async('string');
    const srcBed = info.bed, dstBed = bedBox(arr(pr.printable_area));
    const nPlates = info.plates, cols = colCount(nPlates);
    // which plate each (object, instance) sits on
    const plateOf = {};
    let pi = 0;
    for (const m of ms.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const id = +((/key="plater_id" value="(\d+)"/.exec(m[1]) || [])[1] || (pi + 1));
      for (const inst of m[1].matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
        const o = (/key="object_id" value="(\d+)"/.exec(inst[1]) || [])[1];
        const i = (/key="instance_id" value="(\d+)"/.exec(inst[1]) || [])[1] || '0';
        if (o) plateOf[`${o}:${i}`] = id - 1;
      }
      pi++;
    }
    const wtw = parseFloat(cfg.prime_tower_width) || 30;
    let geo = null;
    if (plan.recenter !== false) { try { geo = await this.geometry(zipIn, false); } catch (e) { report.warnings.push('Could not measure the models (' + e.message + '); plates were shifted by the bed size difference only.'); } }
    const shifts = plan.recenter !== false ? this.plateShifts(info, geo) : null;
    if (shifts) {
      const seen = {};
      let moved = 0;
      model = model.replace(/<item\b[^>]*>/g, tag => {
        const oid = (/objectid="(\d+)"/.exec(tag) || [])[1];
        const tm = /transform="([^"]*)"/.exec(tag);
        if (!oid || !tm) return tag;
        const inst = seen[oid] = (seen[oid] === undefined ? 0 : seen[oid] + 1);
        const plate = plateOf[`${oid}:${inst}`] ?? 0;
        const t = tm[1].trim().split(/\s+/).map(Number);
        if (t.length !== 12 || t.some(isNaN)) return tag;
        const os = plateOrigin(plate, cols, srcBed), od = plateOrigin(plate, cols, dstBed), sh = shifts[plate] || shifts[0];
        t[9] = t[9] - os.x + sh.dx + od.x; t[10] = t[10] - os.y + sh.dy + od.y;
        moved++;
        return tag.replace(tm[0], `transform="${t.map(v => +v.toFixed(9)).join(' ')}"`);
      });
      if (moved) report.fixed.push(`Centred ${nPlates > 1 ? 'each plate\'s models' : 'the models'} on the U1's ${dstBed.w}×${dstBed.d} mm bed${geo ? ' using their real size' : ''} (was a ${srcBed.w}×${srcBed.d} mm bed).`);
      shifts.forEach((sh, i) => {
        if (!sh.fromMesh) return;
        const p = nPlates > 1 ? `Plate ${i + 1}: models` : 'Models';
        if (sh.w > dstBed.w || sh.d > dstBed.d) report.warnings.push(`${p} take ${Math.round(sh.w)}×${Math.round(sh.d)} mm, more than the U1 bed (${dstBed.w}×${dstBed.d} mm). Move some to another plate in Snapmaker Orca.`);
        else if (sh.w > dstBed.w - 7 || sh.d > dstBed.d - 7) report.warnings.push(`${p} take ${Math.round(sh.w)}×${Math.round(sh.d)} mm and come within 3.5 mm of the bed edge. Spiral Z-hop may warn; use Arrange (A) or another Z-hop type.`);
      });
    }
    // prime tower position per plate (plate-local coordinates)
    const sx = arr(srcCfg.wipe_tower_x) || [], sy = arr(srcCfg.wipe_tower_y) || [];
    const wx = [], wy = [];
    for (let i = 0; i < nPlates; i++) {
      let x = parseFloat(sx[i] ?? sx[0]), y = parseFloat(sy[i] ?? sy[0]);
      const sh = shifts && (shifts[i] || shifts[0]);
      if (isNaN(x) || isNaN(y)) { x = parseFloat(first(this.tpl.wipe_tower_x)) || 13; y = parseFloat(first(this.tpl.wipe_tower_y)) || 211; }
      else if (sh) { x += sh.dx; y += sh.dy; }
      const clamp = (px, py) => [Math.min(Math.max(px, dstBed.minX + 2), dstBed.maxX - wtw - 2), Math.min(Math.max(py, dstBed.minY + 2), dstBed.maxY - wtw * 1.5 - 2)];
      [x, y] = clamp(x, y);
      // keep the prime tower clear of the models (tower ≈ width × 1.5·width)
      if (sh && sh.box) {
        const b = { minX: sh.box.minX + sh.dx - 5, maxX: sh.box.maxX + sh.dx + 5, minY: sh.box.minY + sh.dy - 5, maxY: sh.box.maxY + sh.dy + 5 };
        const hits = (px, py) => px < b.maxX && px + wtw > b.minX && py < b.maxY && py + wtw * 1.5 > b.minY;
        if (hits(x, y)) {
          const cands = [[dstBed.minX + 5, dstBed.maxY - wtw * 1.5 - 5], [dstBed.maxX - wtw - 5, dstBed.maxY - wtw * 1.5 - 5], [dstBed.minX + 5, dstBed.minY + 5], [dstBed.maxX - wtw - 5, dstBed.minY + 5]];
          const free = cands.find(([px, py]) => !hits(px, py));
          if (free) { [x, y] = free; report.fixed.push(`${nPlates > 1 ? `Plate ${i + 1}: moved` : 'Moved'} the prime tower to a corner clear of the models.`); }
          else report.warnings.push(`${nPlates > 1 ? `Plate ${i + 1}: the` : 'The'} prime tower may touch the models. Move it in Snapmaker Orca.`);
        }
      }
      wx.push(String(+x.toFixed(3))); wy.push(String(+y.toFixed(3)));
    }
    cfg.wipe_tower_x = wx; cfg.wipe_tower_y = wy;

    // ---------- model_settings.config ----------
    if (ms) {
      let extFixed = 0, metaFixed = 0, metaDropped = 0;
      ms = ms.replace(/(key="extruder" value=")(\d+)(")/g, (m, a, v, b) => { if (+v > 0 && slotOf(+v) !== +v) extFixed++; return a + (+v > 0 ? slotOf(+v) : v) + b; });
      ms = ms.replace(/(opt_key="extruder">\s*)(\d+)/g, (m, a, v) => a + (+v > 0 ? slotOf(+v) : v));
      // per-object / per-part setting overrides: fix values Snapmaker Orca rejects
      ms = ms.replace(/<metadata key="([a-z0-9_]+)" value="([^"]*)"\s*\/>/g, (tag, k, v) => {
        if (!this.defs[k] || k === 'extruder') return tag;
        const val = this.validate(k, v.includes(',') && /s$/.test(this.defs[k].t) ? v.split(',') : v);
        if (val.invalid) { metaDropped++; report.fixed.push(`Object setting ${k}: ${val.note} — removed (uses the process value)`); return ''; }
        if (val.changed) { metaFixed++; report.fixed.push(`Object setting ${k}: ${val.note} — set to ${val.value}`); return `<metadata key="${k}" value="${xmlEsc(Array.isArray(val.value) ? val.value.join(',') : val.value)}"/>`; }
        return tag;
      });
      // plate metadata Bambu-specific or pointing at removed files
      ms = ms.replace(/\s*<metadata key="(filament_map_mode|filament_maps|filament_map|first_layer_print_sequence|other_layers_print_sequence|other_layers_print_sequence_nums)" value="[^"]*"\s*\/>/g, '');
      ms = ms.replace(/(<metadata key="(?:gcode_file|pattern_bbox_file)" value=")[^"]*(")/g, '$1$2');
      if (extFixed) report.fixed.push(`Re-assigned ${extFixed} object/part filament${extFixed > 1 ? 's' : ''} to the new U1 slots.`);
    }

    // ---------- painted triangles ----------
    const out = new JSZipCtor();
    let painted = 0, paintFail = 0;
    const mapState = st => st > 0 ? slotOf(st) : 0;
    for (const name of Object.keys(zipIn.files)) {
      const f = zipIn.files[name];
      if (f.dir) continue;
      if (DROP_FILES.some(r => r.test(name))) { report.removedFiles.push(name); continue; }
      if (name === 'Metadata/project_settings.config') { out.file(name, JSON.stringify(cfg, null, 4)); continue; }
      if (name === msName) { out.file(name, ms); continue; }
      if (/^3D\/.*\.model$/i.test(name)) {
        let t = name === '3D/3dmodel.model' ? model : await f.async('string');
        if (!identity && t.indexOf('paint_color') >= 0) {
          t = t.replace(/paint_color="([0-9A-Fa-f]+)"/g, (m, s) => {
            try { const r = remapPaint(s, mapState); painted++; return `paint_color="${r}"`; } catch (e) { paintFail++; return m; }
          });
        }
        out.file(name, t);
        continue;
      }
      if (name === 'Metadata/custom_gcode_per_layer.xml') {
        const t = (await f.async('string')).replace(/(extruder=")(\d+)(")/g, (m, a, v, b) => a + (+v > 0 ? slotOf(+v) : v) + b);
        out.file(name, t);
        continue;
      }
      out.file(name, await f.async('uint8array'));
    }
    out.file('Metadata/slice_info.config', '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value=""/>\n  </header>\n</config>\n');
    if (painted) report.fixed.push(`Re-coloured ${painted.toLocaleString()} painted triangle${painted > 1 ? 's' : ''} for the new slot order.`);
    if (paintFail) report.warnings.push(`${paintFail} painted triangle${paintFail > 1 ? 's' : ''} used an encoding this tool doesn't recognise and kept their original filament numbers.`);
    if (report.removedFiles.some(n => /_settings_\d+\.config$|print_setting_/i.test(n))) report.fixed.push('Removed the Bambu printer/filament/process presets embedded in the file (the "customized presets — check the G-code" warning).');
    if (report.removedFiles.some(n => /\.gcode$/i.test(n))) report.fixed.push('Removed old Bambu G-code and slice results stored in the file.');
    report.fixed.unshift(`Printer set to ${printerName} and process to ${plan.process} (fixes the P1S G-code errors such as "G92 E0 … layer_gcode").`);
    report.config = cfg;
    return { zip: out, report };
  };

  /** Triangles of one plate in U1 bed coordinates, coloured by U1 slot (for the 3D preview). */
  P.previewMesh = async function (zip, info, plan, plate) {
    const geo = await this.geometry(zip, true);
    const srcBed = info.bed, dstBed = this.dstBed({ nozzle: plan.nozzle });
    const cols = colCount(info.plates);
    const shifts = this.plateShifts(info, geo);
    const sh = plan.recenter !== false ? (shifts[plate] || shifts[0]) : { dx: 0, dy: 0 };
    const o = plateOrigin(plate, cols, srcBed);
    const slotOf = idx => +(plan.map[idx] || 1);
    let n = 0;
    const its = geo.items.filter(it => (info.plateOf[`${it.objectid}:${it.instance}`] ?? 0) === plate);
    for (const it of its) for (const p of geo.objects[it.objectid].parts) n += p.mesh.tris ? p.mesh.tris.length / 3 : 0;
    const pos = new Float32Array(n * 9), slot = new Uint8Array(n);
    let t = 0;
    for (const it of its) {
      const ex = info.extruders[it.objectid] || { ext: 1, parts: {} };
      for (const p of geo.objects[it.objectid].parts) {
        const M = mul(p.transform, it.transform), v = p.mesh.verts, tr = p.mesh.tris;
        if (!tr) continue;
        const partSlot = slotOf(ex.parts[p.partId] || ex.ext || 1);
        for (let k = 0; k < tr.length; k += 3, t++) {
          for (let c = 0; c < 3; c++) {
            const i = tr[k + c] * 3, b = t * 9 + c * 3;
            pos[b] = v[i] * M[0] + v[i + 1] * M[3] + v[i + 2] * M[6] + M[9] - o.x + sh.dx;
            pos[b + 1] = v[i] * M[1] + v[i + 1] * M[4] + v[i + 2] * M[7] + M[10] - o.y + sh.dy;
            pos[b + 2] = v[i] * M[2] + v[i + 1] * M[5] + v[i + 2] * M[8] + M[11];
          }
          const pc = p.mesh.paint && p.mesh.paint[k / 3];
          const st = pc ? paintDominant(pc) : 0;
          slot[t] = st > 0 ? slotOf(st) : partSlot;
        }
      }
    }
    return { positions: pos, slots: slot, bed: dstBed, triangles: n };
  };

  const api = { Converter3MF, remapPaint, paintDominant, bedBox, colCount, plateOrigin, SLOTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.B2U3 = api;
})(typeof window !== 'undefined' ? window : globalThis);
