// Self-contained checks with synthetic fixtures. Run: npm test
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const JSZip = require('jszip');
const { Converter, resolve } = require('../src/core.js');
const { Converter3MF, remapPaint } = require('../src/threemf.js');

const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '../data/presets.json.gz'))).toString());
const conv = new Converter(data);
const c3 = new Converter3MF(data, conv);
let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ✓ ' + name); });

// ---------- fixtures ----------
function filamentPresets() {
  const abs = Object.assign({}, resolve(conv.bbl, 'Bambu ABS @BBL P1S 0.4 nozzle'));
  delete abs.setting_id;
  Object.assign(abs, { name: 'Test ABS @BBL P1S', inherits: '', from: 'User', version: '2.2.0.4', filament_settings_id: ['Test ABS @BBL P1S'], filament_vendor: ['TestVendor'], nozzle_temperature: ['255', '255'] });
  return [
    { name: 'Test PLA @BBL P1S', inherits: 'Generic PLA', from: 'User', version: '2.2.0.4', filament_settings_id: ['Test PLA @BBL P1S'],
      compatible_printers: ['Bambu Lab P1S 0.4 nozzle'], filament_vendor: ['TestVendor'], nozzle_temperature: ['215', '215'],
      filament_max_volumetric_speed: ['18', '18'], filament_start_gcode: ['M106 P3 S150'], filament_scarf_seam_type: ['all'] },
    { name: 'Matte tuned @BBL P1S', inherits: 'Bambu PLA Matte @BBL P1S 0.4 nozzle', from: 'User', version: '2.2.0.4',
      filament_settings_id: ['Matte tuned @BBL P1S'], filament_flow_ratio: ['0.97', '0.98'] },
    { name: 'PETG @BBL P1S 0.6 nozzle', inherits: 'No Such Parent @BBL P1S 0.6 nozzle', from: 'User', version: '1.10.0.0',
      filament_settings_id: ['PETG @BBL P1S 0.6 nozzle'], filament_type: ['PETG'], nozzle_temperature: ['240'] },
    abs,
  ];
}

function encTree(depth, rnd) {
  const out = [];
  (function node(d) {
    if (d > 0 && rnd() < 0.4) {
      const split = 1 + Math.floor(rnd() * 3), special = Math.floor(rnd() * 3);
      out.push(split | (special << 2));
      for (let i = 0; i <= split; i++) node(d - 1);
    } else {
      const st = Math.floor(rnd() * 6);
      if (st < 3) out.push(st << 2); else { out.push(12); out.push(st - 3); }
    }
  })(depth);
  return out.map(x => '0123456789ABCDEF'[x]).reverse().join('');
}

async function bambuProject() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trees = Array.from({ length: 50 }, () => encTree(4, rnd));
  const tri = c => `<triangle v1="0" v2="1" v3="2"${c ? ` paint_color="${c}"` : ''}/>`;
  const obj = (id, paints) => `<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles>${paints.map(tri).join('')}</triangles></mesh></object>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-02.03.00.70</metadata>
 <resources>${obj(1, ['4', '8', '0C', '1C', '2C', ''].concat(trees))}${obj(2, ['8'])}${obj(3, [''])}</resources>
 <build>
  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 5" printable="1"/>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 60 200 5" printable="1"/>
  <item objectid="3" transform="1 0 0 0 1 0 0 0 1 435.2 128 5" printable="1"/>
 </build>
</model>`;
  const ms = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="A"/><metadata key="extruder" value="1"/><metadata key="tree_support_wall_count" value="-1"/>
    <part id="1" subtype="normal_part"><metadata key="extruder" value="4"/></part></object>
  <object id="2"><metadata key="name" value="B"/><metadata key="extruder" value="5"/><metadata key="ensure_vertical_shell_thickness" value="enabled"/></object>
  <object id="3"><metadata key="name" value="C"/><metadata key="extruder" value="3"/>
    <layer_config_ranges><range min_z="0" max_z="2"><option opt_key="extruder">5</option></range></layer_config_ranges></object>
  <plate><metadata key="plater_id" value="1"/><metadata key="filament_maps" value="1 1 1 1 1"/><metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance></plate>
  <plate><metadata key="plater_id" value="2"/>
    <model_instance><metadata key="object_id" value="3"/><metadata key="instance_id" value="0"/></model_instance></plate>
</config>`;
  const cfg = {
    version: '02.03.00.70', from: 'project', name: 'project_settings', printer_settings_id: 'Bambu Lab P1S 0.4 nozzle - Copy',
    print_settings_id: '0.16mm Optimal @BBL X1C', printable_area: ['0x0', '256x0', '256x256', '0x256'], nozzle_diameter: ['0.4'], layer_height: '0.16',
    filament_colour: ['#FF0000', '#00FF00', '#0000FF', '#000000', '#FF8800'], filament_type: ['PLA', 'PLA', 'PETG', 'PLA', 'PLA'],
    filament_settings_id: ['Bambu PLA Basic @BBL X1C', 'Bambu PLA Basic @BBL X1C', 'Bambu PETG HF @BBL P1S 0.4 nozzle', 'Bambu PLA Matte @BBL X1C', 'Generic PLA'],
    filament_vendor: ['Bambu Lab', 'Bambu Lab', 'Bambu Lab', 'Bambu Lab', 'Generic'],
    different_settings_to_system: ['wall_loops;sparse_infill_density;tree_support_wall_count;ensure_vertical_shell_thickness;enable_support;outer_wall_speed;bogus_key;support_filament', '', '', '', '', '', ''],
    wall_loops: '3', sparse_infill_density: '25%', tree_support_wall_count: '-1', ensure_vertical_shell_thickness: 'enabled', enable_support: '1',
    outer_wall_speed: ['250'], bogus_key: '7', support_filament: '5', nozzle_volume_type: ['Standard'], wipe_tower_x: ['165', '165'], wipe_tower_y: ['220', '220'],
  };
  const z = new JSZip();
  z.file('3D/3dmodel.model', model);
  z.file('Metadata/model_settings.config', ms);
  z.file('Metadata/project_settings.config', JSON.stringify(cfg));
  z.file('Metadata/machine_settings_1.config', '{}');
  z.file('Metadata/plate_1.gcode', 'G28');
  z.file('Metadata/custom_gcode_per_layer.xml', '<custom_gcodes_per_layer><plate><layer top_z="3" type="0" extruder="5"/></plate></custom_gcodes_per_layer>');
  return { zip: await JSZip.loadAsync(await z.generateAsync({ type: 'nodebuffer' })), trees };
}

(async () => {
  console.log('filament presets');
  const entries = filamentPresets().map(p => ({ name: p.name + '.json', text: JSON.stringify(p) }));
  entries.push({ name: 'process.json', text: JSON.stringify({ type: 'process', print_settings_id: ['x'] }) });
  const col = conv.collect(entries);
  const results = conv.uniqueNames(col.presets.map(p => conv.build(conv.analyse(p.json, col.userLib), {})));
  const sm = data.sm;
  await ok('skips non-filament presets', () => assert.strictEqual(col.skipped.length, 1));
  await ok('every preset passes the Snapmaker Orca importer rules', () => {
    for (const r of results) {
      const p = r.preset;
      assert.match(p.version, /^\d+\.\d+\.\d+\.\d+$/);
      assert.ok(Array.isArray(p.filament_settings_id));
      assert.ok(sm[p.inherits], 'parent exists: ' + p.inherits);
      assert.ok(!sm[p.name], 'name is not a system preset');
      for (const k of Object.keys(p)) assert.ok(conv.smKeys.has(k) || ['type', 'name', 'inherits', 'from', 'instantiation', 'is_custom_defined', 'version', 'filament_settings_id', 'filament_id'].includes(k), 'valid key ' + k);
    }
  });
  const pla = results.find(r => r.name === 'Test PLA @U1');
  await ok('carries only real changes onto the U1 base', () => {
    assert.strictEqual(pla.target, conv.targetName('Generic PLA', '0.4').name);
    assert.deepStrictEqual(pla.preset.nozzle_temperature, ['215']);
    assert.ok(!('filament_start_gcode' in pla.preset));
    assert.ok(pla.dropped.some(d => d.key === 'filament_scarf_seam_type'));
  });
  await ok('product-parent presets keep the product traits (e.g. PETG HF temperature)', () => {
    const j = { name: 'My PETG HF @BBL P1S', inherits: 'Bambu PETG HF @BBL P1S 0.4 nozzle', from: 'User', version: '2.2.0.4', filament_settings_id: ['My PETG HF @BBL P1S'], fan_max_speed: ['55'] };
    const c2 = conv.collect([{ name: 'a.json', text: JSON.stringify(j) }]);
    const r = conv.build(conv.analyse(c2.presets[0].json, c2.userLib), {});
    const parent = resolve(conv.bbl, 'Bambu PETG HF @BBL P1S 0.4 nozzle');
    assert.deepStrictEqual(r.preset.nozzle_temperature, [String(parent.nozzle_temperature[0])]);
    const fan = r.rows.find(x => x.key === 'fan_max_speed'), temp = r.rows.find(x => x.key === 'nozzle_temperature');
    assert.strictEqual(fan.why, 'your change'); assert.strictEqual(temp.why, 'product');
    assert.ok(!r.dropped.some(d => d.key !== 'fan_max_speed' && /Bambu-only/.test(d.reason) && !(d.key in j)));
  });
  await ok('maps standard / high-flow hotend slots', () => {
    const m = results.find(r => r.name === 'Matte tuned @U1');
    assert.deepStrictEqual(m.preset.filament_flow_ratio, ['0.97', '0.98']);
  });
  await ok('handles a missing parent and a 0.6 mm nozzle', () => {
    const p = results.find(r => r.name.startsWith('PETG @U1'));
    assert.strictEqual(p.nozzle, '0.6');
    assert.ok(p.warnings.some(w => /not found/.test(w)));
  });
  await ok('self-contained preset compares against Bambu generic', () => {
    const a = results.find(r => r.name === 'Test ABS @U1');
    assert.deepStrictEqual(a.preset.nozzle_temperature, ['255']);
    assert.ok(!('chamber_temperatures' in a.preset));
  });
  await ok('manual overrides win', () => {
    const plan = conv.analyse(col.presets[0].json, col.userLib);
    plan.overrides = { nozzle_temperature: ['212'], pressure_advance: ['0.03'], not_a_key: ['1'] };
    const r = conv.build(plan, {});
    assert.deepStrictEqual(r.preset.nozzle_temperature, ['212']);
    assert.deepStrictEqual(r.preset.pressure_advance, ['0.03']);
    assert.ok(!('not_a_key' in r.preset));
  });

  console.log('filament libraries');
  const lib = conv.library();
  await ok('lists Bambu and OrcaSlicer-library filaments', () => {
    for (const id of ['bambu|Bambu PLA Matte', 'bambu|Bambu PLA Silk+', 'bambu|Bambu PETG HF', 'orca|SUNLU PETG']) assert.ok(lib.byId[id], id);
    assert.ok(!lib.list.some(e => e.vendor === 'Generic'));
  });
  await ok('library filament = its difference from the generic, on the U1 generic', () => {
    const r = conv.build(conv.analyseLibrary('orca|SUNLU PETG', '0.4'), {});
    assert.strictEqual(conv.u1BaseOf[r.target], 'Generic PETG');
    assert.deepStrictEqual(r.preset.nozzle_temperature, ['245']);
    assert.deepStrictEqual(r.preset.filament_vendor, ['SUNLU']);
    const silk = conv.build(conv.analyseLibrary('bambu|Bambu PLA Silk+', '0.4'), {});
    assert.strictEqual(conv.u1BaseOf[silk.target], 'Generic PLA Silk');
    assert.ok(sm[silk.preset.inherits]);
  });
  await ok('scales max volumetric speed instead of copying it', () => {
    const r = conv.build(conv.analyseLibrary('bambu|Bambu PLA Basic', '0.4'), {});
    const row = r.rows.find(x => x.key === 'filament_max_volumetric_speed');
    assert.strictEqual(row.why, 'scaled');
  });

  await ok('calibration results go into the right hotend slot', () => {
    const r = conv.build(conv.analyseLibrary('bambu|Bambu PLA Matte', '0.4'), {});
    const cur = conv.presetValues(r.preset, 'standard');
    assert.ok(cur.maxvol && cur.temp);
    const c = conv.applyCalibration(r.preset, { flow: '0.97', pa: '0.032', maxvol: '18', temp: '', retract: '0.6' }, 'standard', '2026-11-04');
    const v = conv.presetValues(c, 'standard');
    assert.strictEqual(v.flow, '0.97'); assert.strictEqual(v.pa, '0.032'); assert.strictEqual(v.maxvol, '18'); assert.strictEqual(v.retract, '0.6');
    assert.strictEqual(v.temp, cur.temp);
    const full = Object.assign({}, data.sm[c.inherits], c);
    if (Array.isArray(c.enable_pressure_advance)) assert.strictEqual(c.enable_pressure_advance[0], '1');
    assert.match(c.filament_notes[0], /U1 calibration 2026-11-04/);
  });

  console.log('3mf projects');
  const { zip, trees } = await bambuProject();
  await ok('paint encoding round-trips', () => { for (const t of trees) assert.strictEqual(remapPaint(t, x => x), t); });
  await ok('paint codes remap', () => assert.deepStrictEqual(['4', '8', '0C', '1C', '2C'].map(s => remapPaint(s, x => (x === 5 ? 1 : x))), ['4', '8', '0C', '1C', '4']));
  const info = await c3.inspect(zip);
  await ok('reads filaments, plates and paint', () => {
    assert.strictEqual(info.filaments.length, 5);
    assert.strictEqual(info.plates, 2);
    assert.ok(info.paintedTris > 50);
    assert.strictEqual(info.embedded.length, 1);
  });
  const plan = c3.defaultPlan(info);
  plan.map[5] = 4;
  const { zip: out, report } = await c3.convert(zip, info, plan, { JSZip });
  const cfg = JSON.parse(await out.file('Metadata/project_settings.config').async('string'));
  await ok('uses the U1 printer, process and 4 slots', () => {
    assert.strictEqual(cfg.printer_settings_id, 'Snapmaker U1 (0.4 nozzle)');
    assert.ok(data.smProc[cfg.print_settings_id]);
    assert.strictEqual(cfg.filament_settings_id.length, 4);
    for (const s of cfg.filament_settings_id) assert.ok(sm[s], s);
    const total = cfg.filament_flow_step_size.map(Number).reduce((a, b) => a + b, 0);
    for (const k of c3.filVariantKeys) if (cfg[k]) assert.strictEqual(cfg[k].length, total, k);
  });
  await ok('fixes values Snapmaker Orca rejects', () => {
    assert.strictEqual(cfg.ensure_vertical_shell_thickness, 'ensure_all');
    for (const [k, v] of Object.entries(cfg)) { const r = c3.validate(k, v); assert.ok(!r.invalid && !r.changed, k + ' ' + r.note); }
  });
  await ok('carries model settings, not printer settings', () => {
    assert.strictEqual(cfg.wall_loops, '3');
    assert.strictEqual(String(cfg.support_filament), '4');
    assert.ok(report.skipped.some(s => s.key === 'outer_wall_speed'));
  });
  await ok('centres each plate\'s models on the U1 bed by their real size', async () => {
    const out2 = await JSZip.loadAsync(await out.generateAsync({ type: 'nodebuffer' }));
    const info2 = await c3.inspect(out2);
    info2.bed = c3.dstBed(info2);
    const geo = await c3.geometry(out2, false);
    const sh = c3.plateShifts(info2, geo);
    for (const p of sh) { assert.ok(Math.abs(p.dx) < 0.01 && Math.abs(p.dy) < 0.01, 'plate centred: ' + JSON.stringify(p)); }
    for (let i = 0; i < cfg.wipe_tower_x.length; i++) {
      const x = +cfg.wipe_tower_x[i], y = +cfg.wipe_tower_y[i];
      assert.ok(x >= 0.5 && x <= 270.5 - 30 && y >= 1 && y <= 271 - 45, 'tower on bed');
    }
  });
  await ok('maps Bambu colours onto the loaded U1 spools', () => {
    const spools = [
      { colour: '#000000', preset: { kind: 'system', name: conv.targetName('Generic PLA', '0.4').name } },
      { colour: '#FF0000', preset: { kind: 'system', name: conv.targetName('Generic PLA', '0.4').name } },
      { colour: '#00FF00', preset: { kind: 'system', name: conv.targetName('Generic PLA', '0.4').name } },
      { colour: '#0000FF', preset: { kind: 'system', name: conv.targetName('Generic PETG HF', '0.4').name } },
    ];
    const p = c3.defaultPlan(info, { spools, nozzle: '0.4' });
    assert.deepStrictEqual(p.map, { 1: 2, 2: 3, 3: 4, 4: 1, 5: 2 });
  });
  await ok('3D preview colours triangles by U1 slot', async () => {
    const pv = await c3.previewMesh(zip, info, plan, 0);
    assert.ok(pv.triangles > 50 && pv.positions.length === pv.triangles * 9);
    assert.ok([...pv.slots].every(s => s >= 1 && s <= 4));
    assert.ok(new Set(pv.slots).size >= 3);
  });
  await ok('remaps parts, ranges, layer changes and paint', async () => {
    const ms = await out.file('Metadata/model_settings.config').async('string');
    assert.match(ms, /<object id="2"><metadata key="name" value="B"\/><metadata key="extruder" value="4"\/>/);
    assert.match(ms, /opt_key="extruder">4/);
    assert.match(ms, /key="tree_support_wall_count" value="0"/);
    assert.ok(!/filament_maps/.test(ms));
    assert.match(await out.file('Metadata/custom_gcode_per_layer.xml').async('string'), /extruder="4"/);
    const m = await out.file('3D/3dmodel.model').async('string');
    for (const p of m.matchAll(/paint_color="([^"]*)"/g)) remapPaint(p[1], x => { assert.ok(x <= 4); return x; });
  });
  await ok('removes embedded Bambu presets and old G-code', () => {
    const names = Object.keys(out.files);
    assert.ok(!names.some(f => /machine_settings_|\.gcode$/.test(f)));
  });
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error('\n✗ ' + (e && e.stack || e)); process.exit(1); });
