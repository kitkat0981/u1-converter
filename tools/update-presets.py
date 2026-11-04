#!/usr/bin/env python3
"""Rebuild data/presets.json.gz from the upstream projects.

    python3 tools/update-presets.py

Downloads (sparse, shallow) into tools/upstream/:
  - bambulab/BambuStudio          resources/profiles/BBL/filament
  - Snapmaker/snapmaker-profiles  Snapmaker/{filament,process,machine}
  - Snapmaker/OrcaSlicer          src/libslic3r (option lists, ranges and enums)
  - josuanbn/bl2u1                u1_template.3mf (base project settings, GPL-3.0)
Then run `npm test` and commit data/presets.json.gz.
"""
import glob, gzip, json, os, re, subprocess, sys, zipfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UP = os.path.join(ROOT, 'tools', 'upstream')
REPOS = {
    'bambu': ('https://github.com/bambulab/BambuStudio.git', ['resources/profiles/BBL/filament']),
    'smp': ('https://github.com/Snapmaker/snapmaker-profiles.git', None),
    'orca': ('https://github.com/Snapmaker/OrcaSlicer.git', ['src/libslic3r']),
    'bl2u1': ('https://github.com/josuanbn/bl2u1.git', None),
}


def git(*a, cwd=None):
    return subprocess.run(['git', *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def fetch(name):
    url, sparse = REPOS[name]
    d = os.path.join(UP, name)
    if not os.path.isdir(os.path.join(d, '.git')):
        args = ['clone', '--depth', '1'] + (['--filter=blob:none', '--sparse'] if sparse else []) + [url, d]
        print('cloning', url)
        git(*args)
        if sparse:
            git('sparse-checkout', 'set', *sparse, cwd=d)
    else:
        print('updating', name)
        git('pull', '--ff-only', cwd=d)
    return d, git('log', '-1', '--format=%h %cs', cwd=d)


def load_lib(d):
    lib = {}
    for f in glob.glob(os.path.join(d, '*.json')):
        try:
            j = json.load(open(f, encoding='utf-8-sig'))
        except Exception as e:
            print('  skip', os.path.basename(f), e)
            continue
        if isinstance(j, dict) and 'name' in j:
            lib[j['name']] = j
    return lib


def chain(lib, pred):
    need = set()

    def walk(n):
        if n in need or n not in lib:
            return
        need.add(n)
        j = lib[n]
        if j.get('inherits'):
            walk(j['inherits'])
        for i in j.get('include', []) or []:
            walk(i)
    for n in lib:
        if pred(n):
            walk(n)
    return {n: lib[n] for n in need}


def option_lists(orca):
    pre = open(os.path.join(orca, 'src/libslic3r/Preset.cpp'), encoding='utf-8').read()

    def grab(a, b):
        i = pre.index('static std::vector<std::string> ' + a)
        j = pre.index('static std::vector<std::string> ' + b, i)
        s = re.sub(r'/\*.*?\*/', '', pre[i:j], flags=re.S)
        s = re.sub(r'//[^\n]*', '', s)
        return re.findall(r'"([a-zA-Z0-9_]+)"', s)
    return {
        'filament': grab('s_Preset_filament_options', 's_Preset_machine_limits_options'),
        'print': grab('s_Preset_print_options', 's_Preset_filament_options'),
        'printer': grab('s_Preset_printer_options', 's_Preset_sla_print_options') + grab('s_Preset_machine_limits_options', 's_Preset_printer_options'),
    }


def option_defs(orca):
    src = open(os.path.join(orca, 'src/libslic3r/PrintConfig.cpp'), encoding='utf-8').read()
    num = r'(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*;'
    defs = {}
    for p in re.split(r'\n\s*def = this->add(?:_nullable)?\("', src)[1:]:
        m = re.match(r'([a-zA-Z0-9_]+)",\s*(co\w+)', p)
        if not m:
            continue
        k, t = m.groups()
        body = p[:8000]
        cut = re.search(r'\n\s*def = ', body)
        if cut:
            body = body[:cut.start()]
        d = {'t': t}
        mn = re.search(r'def->min\s*=\s*' + num, body)
        mx = re.search(r'def->max\s*=\s*' + num, body)
        if mn:
            d['min'] = float(mn.group(1))
        if mx:
            d['max'] = float(mx.group(1))
        ev = re.findall(r'enum_values\.push_back\("([^"]*)"\)', body)
        if ev:
            d['enum'] = ev
        defs[k] = d
    return defs


def main():
    os.makedirs(UP, exist_ok=True)
    bambu, bv = fetch('bambu')
    smp, sv = fetch('smp')
    orca, ov = fetch('orca')
    bl, blv = fetch('bl2u1')

    bbl = load_lib(os.path.join(bambu, 'resources/profiles/BBL/filament'))
    sm = chain(load_lib(os.path.join(smp, 'Snapmaker/filament')), lambda n: '@U1' in n)
    proc = chain(load_lib(os.path.join(smp, 'Snapmaker/process')), lambda n: 'Snapmaker U1' in n)
    mach = chain(load_lib(os.path.join(smp, 'Snapmaker/machine')), lambda n: n.startswith('Snapmaker U1'))
    keys = option_lists(orca)
    allk = set(keys['filament']) | set(keys['print']) | set(keys['printer'])
    defs = {k: v for k, v in option_defs(orca).items() if k in allk and ('min' in v or 'max' in v or 'enum' in v)}
    with zipfile.ZipFile(os.path.join(bl, 'u1_template.3mf')) as z:
        tpl = json.loads(z.read('Metadata/project_settings.config').decode('utf-8-sig'))

    if len(bbl) < 1000 or len(sm) < 50 or len(proc) < 10 or not mach:
        sys.exit(f'Unexpected upstream layout (bambu {len(bbl)}, U1 filaments {len(sm)}, processes {len(proc)}, machines {len(mach)})')
    data = {
        'bbl': bbl, 'sm': sm, 'smProc': proc, 'smMach': mach,
        'smKeys': keys['filament'], 'printKeys': keys['print'], 'printerKeys': keys['printer'], 'defs': defs, 'tpl': tpl,
        'meta': {'bambu': f'bambulab/BambuStudio {bv}', 'snapmaker': f'Snapmaker/snapmaker-profiles {sv}',
                 'orca': f'Snapmaker/OrcaSlicer {ov}', 'template': f'josuanbn/bl2u1 {blv}', 'built': datetime.date.today().isoformat()},
    }
    raw = json.dumps(data, separators=(',', ':')).encode()
    out = os.path.join(ROOT, 'data', 'presets.json.gz')
    with open(out, 'wb') as f:
        f.write(gzip.compress(raw, 9, mtime=0))
    print(f'wrote {out}: {len(bbl)} Bambu filaments, {len(sm)} U1 filaments, {len(proc)} U1 processes, '
          f'{len(mach)} U1 printers, {len(defs)} option rules ({len(raw) // 1024} KB raw)')


if __name__ == '__main__':
    main()
