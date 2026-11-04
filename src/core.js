/* Bambu Studio -> Snapmaker Orca (U1) filament preset converter — core logic.
 * Pure functions, no DOM. Works in browser (window.B2U) and Node (module.exports). */
(function (root) {
  'use strict';

  const META = new Set(['name', 'inherits', 'from', 'setting_id', 'instantiation', 'type', 'renamed_from',
    'version', 'filament_id', 'description', 'include', 'is_custom_defined', 'base_id', 'user_id',
    'updated_time', 'filament_settings_id']);

  // Always copied from the source: properties of the spool itself, not of the printer.
  const MATERIAL_KEYS = ['filament_vendor', 'filament_density', 'filament_cost', 'filament_diameter',
    'temperature_vitrification', 'filament_shrink', 'filament_soluble', 'filament_is_support',
    'nozzle_temperature_range_low', 'nozzle_temperature_range_high', 'required_nozzle_HRC', 'default_filament_colour'];

  // Never copied: U1 hardware / toolchanger / structural keys, or Bambu hardware specifics.
  const EXCLUDE = {
    filament_start_gcode: 'Custom G-code (Bambu commands like M142 / M106 P3 do not apply to the U1)',
    filament_end_gcode: 'Custom G-code (Bambu-specific)',
    filament_long_retractions_when_cut: 'AMS filament-cutter setting (U1 has no cutter)',
    filament_retraction_distances_when_cut: 'AMS filament-cutter setting (U1 has no cutter)',
    compatible_printers: 'Printer link (set to U1)', compatible_printers_condition: 'Printer link',
    compatible_prints: 'Process link', compatible_prints_condition: 'Process link',
    filament_type: 'Kept from the U1 base so U1 material rules keep working',
    filament_flow_support: 'U1 hotend structure', filament_extruder_variant: 'Bambu hotend structure',
    filament_retract_length_toolchange: 'U1 toolchanger tuning', filament_retract_restart_extra_toolchange: 'U1 toolchanger tuning',
    filament_multitool_ramming: 'U1 toolchanger tuning', filament_multitool_ramming_flow: 'U1 toolchanger tuning',
    filament_multitool_ramming_volume: 'U1 toolchanger tuning', filament_minimal_purge_on_wipe_tower: 'U1 toolchanger tuning',
    filament_ramming_parameters: 'U1 toolchanger tuning', filament_toolchange_delay: 'U1 toolchanger tuning',
    filament_cooling_moves: 'U1 toolchanger tuning', filament_cooling_initial_speed: 'U1 toolchanger tuning',
    filament_cooling_final_speed: 'U1 toolchanger tuning', filament_loading_speed: 'U1 toolchanger tuning',
    filament_loading_speed_start: 'U1 toolchanger tuning', filament_unloading_speed: 'U1 toolchanger tuning',
    filament_unloading_speed_start: 'U1 toolchanger tuning', filament_stamping_distance: 'U1 toolchanger tuning',
    filament_stamping_loading_speed: 'U1 toolchanger tuning',
    pressure_advance: 'Extruder-specific — recalibrate on the U1', enable_pressure_advance: 'Extruder-specific — recalibrate on the U1',
    adaptive_pressure_advance: 'Extruder-specific', adaptive_pressure_advance_model: 'Extruder-specific',
    adaptive_pressure_advance_bridges: 'Extruder-specific', adaptive_pressure_advance_overhangs: 'Extruder-specific',
    activate_air_filtration: 'Bambu exhaust/filter hardware', during_print_exhaust_fan_speed: 'Bambu exhaust/filter hardware',
    complete_print_exhaust_fan_speed: 'Bambu exhaust/filter hardware',
    chamber_temperature: 'Chamber heater (U1 has none)', chamber_temperatures: 'Chamber heater (U1 has none)',
    activate_chamber_temp_control: 'Chamber heater (U1 has none)',
  };

  // Bambu key -> Snapmaker Orca key, same meaning.
  const RENAME = { no_slow_down_for_cooling_on_outwalls: 'dont_slow_down_outer_wall' };

  // Bambu filament_type -> U1 generic family
  const TYPE_MAP = {
    'PLA': 'PLA', 'PLA-AERO': 'PLA', 'PLA-CF': 'PLA-CF', 'PETG': 'PETG', 'PETG-CF': 'PETG-CF', 'PET-CF': 'PETG-CF',
    'PETG-GF': 'PETG-GF', 'PCTG': 'PCTG', 'ABS': 'ABS', 'ABS-GF': 'ABS', 'ASA': 'ASA', 'ASA-CF': 'ASA', 'ASA-AERO': 'ASA',
    'PC': 'PC', 'PA': 'PA', 'PA-GF': 'PA', 'PA-CF': 'PA-CF', 'PA6-CF': 'PA-CF', 'PA6-GF': 'PA', 'PPA-CF': 'PA-CF',
    'PPA-GF': 'PA', 'PAHT-CF': 'PA-CF', 'TPU': 'TPU', 'TPU-AMS': 'TPU 95A HF', 'PVA': 'PVA', 'BVOH': 'BVOH',
  };

  const STD = 'standard', HF = 'high_flow';

  function makeLib(raw) {
    const byName = Object.assign({}, raw), alias = {};
    for (const [n, j] of Object.entries(raw)) {
      if (j && j.renamed_from) for (const a of String(j.renamed_from).split(';')) if (a.trim()) alias[a.trim()] = n;
    }
    return { byName, alias, cache: new Map() };
  }
  function findIn(lib, name) {
    if (!name) return null;
    if (lib.byName[name]) return name;
    if (lib.alias[name]) return lib.alias[name];
    return null;
  }
  function resolve(lib, name, depth) {
    depth = depth || 0;
    if (lib.cache.has(name)) return lib.cache.get(name);
    const j = lib.byName[name];
    if (!j || depth > 30) return {};
    const out = {};
    const p = findIn(lib, j.inherits);
    if (p) Object.assign(out, resolve(lib, p, depth + 1));
    for (const inc of (j.include || [])) { const q = findIn(lib, inc); if (q) Object.assign(out, resolve(lib, q, depth + 1)); }
    for (const [k, v] of Object.entries(j)) if (k !== 'include') out[k] = v;
    lib.cache.set(name, out);
    return out;
  }

  const arr = v => Array.isArray(v) ? v : (v === undefined ? undefined : [v]);
  const at = (a, i) => a === undefined ? undefined : (a[i] !== undefined ? a[i] : a[0]);
  const first = v => Array.isArray(v) ? v[0] : v;
  const stripAt = n => String(n || '').replace(/\s*@.*$/, '').trim();
  const nozzleOf = s => { const m = /(\d\.\d)\s*nozzle/.exec(s || ''); return m ? m[1] : null; };

  function hash7(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-7);
  }

  function isFilamentPreset(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
    if (j.type === 'filament') return true;
    if (j.type && j.type !== 'filament') return false;
    return ('filament_settings_id' in j || 'filament_type' in j) && !('print_settings_id' in j) && !('printer_settings_id' in j);
  }

  function Converter(data) {
    this.bbl = makeLib(data.bbl);
    this.sm = makeLib(data.sm);
    this.smKeys = new Set(data.smKeys);
    this.meta = data.meta || {};
    this.u1Names = Object.keys(data.sm).filter(n => /@U1 \d\.\d nozzle$/.test(n) && data.sm[n].instantiation === 'true').sort();
  }

  Converter.prototype.u1Bases = function () {
    const s = new Set(this.u1Names.map(n => n.replace(/ @U1 \d\.\d nozzle$/, '')));
    return [...s].sort();
  };
  Converter.prototype.u1NozzlesFor = function (base) {
    return this.u1Names.filter(n => n.startsWith(base + ' @U1 ')).map(nozzleOf);
  };

  // Find the Bambu parent; tolerate renamed or missing presets.
  Converter.prototype.findParent = function (userLib, j) {
    const inh = j.inherits;
    if (!inh) return { name: null, how: 'none' };
    let n = findIn(userLib, inh);
    if (n) return { name: n, how: 'user' };
    n = findIn(this.bbl, inh);
    if (n) return { name: n, how: 'exact' };
    const base = stripAt(inh) + ' @base';
    n = findIn(this.bbl, base);
    if (n) return { name: n, how: 'base' };
    return { name: null, how: 'missing', wanted: inh };
  };

  // Pick the U1 system preset to build on.
  Converter.prototype.pickTarget = function (srcRes, chain, nozzle) {
    const vendor = String(first(srcRes.filament_vendor) || '');
    const type = String(first(srcRes.filament_type) || 'PLA').toUpperCase();
    const products = [];
    for (const n of [...chain.slice(1), chain[0]]) {
      let p = stripAt(n);
      for (const v of [vendor, 'Bambu Lab', 'Bambu', 'Generic']) if (v && p.startsWith(v + ' ')) { p = p.slice(v.length + 1); break; }
      if (p && !products.includes(p)) products.push(p);
    }
    const tried = [];
    const has = b => this.u1Names.includes(`${b} @U1 ${nozzle} nozzle`) || this.u1Names.includes(`${b} @U1 0.4 nozzle`);
    const cands = [];
    const userProd = products.length > 1 ? products.pop() : null;
    for (const p of products) cands.push(`Generic ${p}`, `Snapmaker ${p}`);
    // keyword hints
    const txt = (chain.join(' ') + ' ' + products.join(' ')).toLowerCase();
    if (type.startsWith('PLA')) {
      if (/silk/.test(txt)) cands.push('Generic PLA Silk');
      if (/matte/.test(txt)) cands.push('Snapmaker PLA Matte');
      if (/high speed|\bhs\b|hyper|rapid/.test(txt)) cands.push('Generic PLA High Speed');
      if (/wood/.test(txt)) cands.push('Snapmaker PLA Wood');
      if (/glow/.test(txt)) cands.push('Snapmaker PLA Glow');
      if (/translucent/.test(txt)) cands.push('Snapmaker PLA Translucent');
    }
    if (type === 'PETG' && /\bhf\b|high flow/.test(txt)) cands.push('Generic PETG HF');
    if (type.startsWith('TPU') && /\bhf\b|95a/.test(txt)) cands.push('Generic TPU 95A HF');
    if (/support/.test(txt) && type.startsWith('PLA')) cands.push('Generic Support For PLA');
    if (userProd) cands.push(`Generic ${userProd}`, `Snapmaker ${userProd}`);
    const fam = TYPE_MAP[type];
    if (fam) cands.push(`Generic ${fam}`);
    cands.push('Generic PLA');
    for (const c of cands) { tried.push(c); if (has(c)) return { base: c, exactType: !!fam || type === 'PLA', fellBack: c === 'Generic PLA' && type !== 'PLA' && !fam }; }
    return { base: 'Generic PLA', fellBack: true };
  };

  Converter.prototype.targetName = function (base, nozzle) {
    const n = `${base} @U1 ${nozzle} nozzle`;
    if (this.u1Names.includes(n)) return { name: n, nozzle };
    return { name: `${base} @U1 0.4 nozzle`, nozzle: '0.4', nozzleFallback: true };
  };

  /**
   * Analyse one Bambu user preset. Returns a plan (no output yet) so the UI can let the user override target/nozzle.
   */
  Converter.prototype.analyse = function (j, userLib) {
    const warnings = [];
    const parent = this.findParent(userLib, j);
    let parentRes = {};
    if (parent.name) parentRes = parent.how === 'user' ? resolveMixed(this, userLib, parent.name) : resolve(this.bbl, parent.name);
    if (parent.how === 'base') warnings.push(`Exact Bambu parent "${j.inherits}" not found; compared against "${parent.name}" instead.`);
    if (!parent.name) {
      // No usable parent: compare against Bambu's generic preset for the same material to find the real customisations.
      const ty = String(first(j.filament_type) || 'PLA');
      const bn = [`Generic ${ty}`, `Generic ${ty} @base`, `Bambu ${ty} @base`, `fdm_filament_${ty.toLowerCase()}`, 'Generic PLA'].map(n => findIn(this.bbl, n)).find(Boolean);
      parentRes = resolve(this.bbl, bn);
      parent.baseline = bn;
      warnings.push(parent.how === 'missing'
        ? `Bambu parent "${parent.wanted}" not found — your values were compared against Bambu "${bn}" to find what you changed.`
        : `Self-contained preset (no parent) — compared against Bambu "${bn}" to find what you changed.`);
    }
    const srcRes = Object.assign({}, parentRes, j);
    // ancestors for naming hints
    const chain = [];
    let cur = parent.name;
    let guard = 0;
    while (cur && guard++ < 20) {
      chain.push(cur);
      const node = (userLib.byName[cur] || this.bbl.byName[cur]);
      cur = node ? (findIn(userLib, node.inherits) || findIn(this.bbl, node.inherits)) : null;
    }
    // nozzle
    let nozzle = null;
    for (const p of (arr(j.compatible_printers) || [])) { nozzle = nozzleOf(p); if (nozzle) break; }
    if (!nozzle) nozzle = nozzleOf(j.inherits) || nozzleOf(parent.name);
    if (!nozzle) {
      const ns = new Set((arr(parentRes.compatible_printers) || []).filter(p => /P1S|P1P/.test(p)).map(nozzleOf).filter(Boolean));
      if (ns.size === 1) nozzle = [...ns][0];
    }
    if (!nozzle) nozzle = '0.4';
    const tgt = this.pickTarget(srcRes, [j.name || '', ...chain], nozzle);
    if (tgt.fellBack) warnings.push(`No U1 equivalent for material type "${first(srcRes.filament_type)}" — based on Generic PLA. Pick a better base below.`);
    const srcName = j.name || first(j.filament_settings_id) || 'Unnamed filament';
    return { srcName, src: j, srcRes, parentRes, parent, chain, nozzle, base: tgt.base, warnings,
      outName: stripAt(srcName) + ' @U1' + (nozzle !== '0.4' ? ` ${nozzle}` : '') };
  };

  function resolveMixed(conv, userLib, name) {
    // a user preset inheriting from another user preset (which inherits from Bambu system)
    const j = userLib.byName[name];
    const p = findIn(userLib, j.inherits);
    const base = p ? resolveMixed(conv, userLib, p) : (findIn(conv.bbl, j.inherits) ? resolve(conv.bbl, findIn(conv.bbl, j.inherits)) : {});
    return Object.assign({}, base, j);
  }

  /**
   * Build the Snapmaker Orca preset.
   * opts: { mode: 'changes'|'all', hotend: 'standard'|'high_flow', standalone: bool, version }
   */
  Converter.prototype.build = function (plan, opts) {
    opts = Object.assign({ mode: 'changes', hotend: STD, standalone: false, version: '2.3.0.0' }, opts || {});
    const warnings = plan.warnings.slice();
    const t = this.targetName(plan.base, plan.nozzle);
    if (t.nozzleFallback) warnings.push(`U1 base "${plan.base}" has no ${plan.nozzle} mm version — using its 0.4 mm version.`);
    const tgtRes = resolve(this.sm, t.name);
    const { srcRes, parentRes, src } = plan;
    const ov0 = plan.overrides || {};

    // Bambu variant indices
    const bv = arr(srcRes.filament_extruder_variant) || [];
    let stdIdx = bv.findIndex(v => /Standard/i.test(v)); if (stdIdx < 0) stdIdx = 0;
    let hfIdx = bv.findIndex(v => /High Flow/i.test(v)); if (hfIdx < 0) hfIdx = stdIdx;
    const myIdx = opts.hotend === HF ? hfIdx : stdIdx;
    const tv = arr(tgtRes.filament_flow_support) || [STD];

    const changes = {};   // key -> new value (full array)
    const rows = [];      // report rows
    const dropped = [];
    const parentKnown = !!(plan.parent.name || plan.parent.baseline);

    const srcKeys = new Set(Object.keys(srcRes));
    for (const sk of srcKeys) {
      if (META.has(sk)) continue;
      const k = RENAME[sk] || sk;
      const userTouched = Object.prototype.hasOwnProperty.call(src, sk);
      const changedFromParent = userTouched && (!parentKnown || JSON.stringify(arr(src[sk])) !== JSON.stringify(arr(parentRes[sk])));
      if (EXCLUDE[k]) {
        if (changedFromParent && !/Printer link|Process link|structure/.test(EXCLUDE[k])) dropped.push({ key: sk, reason: EXCLUDE[k], value: src[sk] });
        continue;
      }
      if (!this.smKeys.has(k)) {
        if (changedFromParent) dropped.push({ key: sk, reason: 'Bambu-only setting (Snapmaker Orca has no equivalent)', value: src[sk] });
        continue;
      }
      const isMaterial = MATERIAL_KEYS.includes(k);
      const sv = srcRes[sk], pv = parentRes[sk];
      const tvVal = tgtRes[k];
      if (!Array.isArray(sv) || (tvVal !== undefined && !Array.isArray(tvVal))) {
        // scalar
        const want = isMaterial || opts.mode === 'all' || changedFromParent;
        if (want && sv !== undefined && JSON.stringify(sv) !== JSON.stringify(tvVal)) {
          changes[k] = sv; rows.push({ key: k, from: sk, u1: tvVal, bambu: sv, result: sv, why: isMaterial ? 'material' : (changedFromParent ? 'your change' : 'copied') });
        }
        continue;
      }
      const base = (arr(tvVal) || [at(sv, 0)]).slice();
      const out = base.slice();
      let any = false, why = isMaterial ? 'material' : 'your change';
      for (let i = 0; i < out.length; i++) {
        const sidx = base.length === 1 ? myIdx : (tv[i] === HF ? hfIdx : stdIdx);
        const s = at(sv, sidx), p = at(arr(pv), sidx);
        let take;
        if (isMaterial) take = s !== undefined && s !== 'nil';
        else if (opts.mode === 'all') { take = s !== undefined && s !== 'nil'; if (!(userTouched && s !== p)) why = 'copied'; }
        else take = s !== undefined && (!parentKnown ? userTouched : (userTouched && JSON.stringify(s) !== JSON.stringify(p)));
        if (take && s !== out[i]) { out[i] = s; any = true; }
      }
      if (any) {
        changes[k] = out;
        rows.push({ key: k, from: sk, u1: tvVal, bambu: sv, result: out, why });
      }
    }

    // Manual overrides from the user win over everything (any valid Snapmaker Orca filament key).
    const ov = plan.overrides || {};
    for (const [k, raw] of Object.entries(ov)) {
      if (!this.smKeys.has(k) || META.has(k)) continue;
      const tval = tgtRes[k];
      let val = Array.isArray(raw) ? raw.slice() : [raw];
      if (Array.isArray(tval) && tval.length && val.length !== tval.length) val = tval.map((_, i) => val[i] !== undefined ? val[i] : val[val.length - 1]);
      if (tval !== undefined && !Array.isArray(tval)) val = val[0];
      changes[k] = val;
      const srcKey = Object.keys(RENAME).find(b => RENAME[b] === k) || k;
      const existing = rows.find(r => r.key === k);
      if (existing) { existing.auto = existing.result; existing.result = val; existing.why = 'manual'; existing.manual = true; }
      else rows.push({ key: k, from: srcKey, u1: tval, bambu: srcRes[srcKey], result: val, why: 'manual', manual: true });
    }

    // Sanity warnings
    const mvs = changes.filament_max_volumetric_speed;
    if (mvs) {
      const lim = arr(tgtRes.filament_max_volumetric_speed);
      mvs.forEach((v, i) => {
        const l = parseFloat(at(lim, i));
        if (parseFloat(v) > l * 1.15) warnings.push(`Max volumetric speed ${v} mm³/s is above the U1 default of ${l} for this material${tv.length > 1 ? ` (${tv[i] === HF ? 'high-flow' : 'standard'} hotend)` : ''}. The U1 hotend may not keep up — run the volumetric speed test.`);
      });
    }
    if (changes.filament_flow_ratio) warnings.push('Flow ratio came from the P1S. Re-run the flow-rate calibration on the U1 before trusting it.');
    if (dropped.some(d => /G-code/.test(d.reason))) warnings.push('Your custom filament start/end G-code was not copied (Bambu-specific). Re-add anything you need using Klipper commands.');

    const name = plan.outName;
    let preset;
    const filamentKeys = [...this.smKeys].filter(k => !META.has(k) && !['compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'inherits'].includes(k)).sort();
    const header = {
      type: 'filament', name, inherits: t.name, from: 'User', instantiation: 'true', is_custom_defined: '0',
      version: opts.version, filament_settings_id: [name], filament_id: 'P' + hash7(name),
      compatible_printers: [`Snapmaker U1 (${t.nozzle} nozzle)`],
    };
    const note = `Converted from Bambu Studio preset "${plan.srcName}"${plan.parent.name ? ` (parent: ${plan.parent.name})` : ''} onto "${t.name}".`;
    const oldNotes = String(first(srcRes.filament_notes) || '').trim();
    if (!ov.filament_notes) changes.filament_notes = [oldNotes ? `${oldNotes}\n${note}` : note];
    if (opts.standalone) {
      const full = {};
      for (const [k, v] of Object.entries(tgtRes)) if (this.smKeys.has(k) && !META.has(k)) full[k] = v;
      preset = Object.assign({}, header, full, changes, { inherits: '', compatible_printers: header.compatible_printers });
    } else {
      preset = Object.assign({}, header, changes);
    }
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return { name, target: t.name, nozzle: t.nozzle, preset, rows, dropped, warnings, variants: tv, tgtRes, filamentKeys };
  };

  // Parse a list of {name, text} JSON entries; returns {presets, skipped}
  Converter.prototype.collect = function (entries) {
    const presets = [], skipped = [];
    for (const e of entries) {
      if (/bundle_structure\.json$/i.test(e.name)) continue;
      let j;
      try { j = JSON.parse(e.text); } catch (err) { skipped.push({ file: e.name, reason: 'Not valid JSON' }); continue; }
      if (!isFilamentPreset(j)) { skipped.push({ file: e.name, reason: j && j.type ? `A ${j.type} preset, not a filament` : 'Not a filament preset' }); continue; }
      if (!j.name) j.name = first(j.filament_settings_id) || e.name.replace(/\.json$/i, '');
      if (j.from === 'system' && this.bbl.byName[j.name]) { skipped.push({ file: e.name, reason: 'Bambu system preset (already built in) — nothing custom to convert' }); continue; }
      presets.push({ file: e.name, json: j });
    }
    return { presets, skipped, userLib: makeLib(Object.fromEntries(presets.map(p => [p.json.name, p.json]))) };
  };

  Converter.prototype.uniqueNames = function (results) {
    const seen = new Set(Object.keys(this.sm.byName));
    for (const r of results) {
      let n = r.name, i = 2;
      while (seen.has(n)) n = `${r.name} (${i++})`;
      seen.add(n);
      if (n !== r.name) { r.name = n; r.preset.name = n; r.preset.filament_settings_id = [n]; r.preset.filament_id = 'P' + hash7(n); }
    }
    return results;
  };

  const api = { Converter, makeLib, resolve, isFilamentPreset, hash7, EXCLUDE, MATERIAL_KEYS, RENAME, TYPE_MAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.B2U = api;
})(typeof window !== 'undefined' ? window : globalThis);
