// Assembles the single-file app: src/page.html + JSZip + src/*.js + data/presets.json.gz -> dist/index.html
// `node build.js`            -> dist/ (self-hosted: with app manifest + offline service worker)
// `node build.js --embedded` -> dist-embedded/index.html (one file, no manifest/service worker)
const fs = require('fs');
const path = require('path');
const embedded = process.argv.includes('--embedded');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const jszip = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');
const core = read('src/core.js');
const threemf = read('src/threemf.js');
const data = fs.readFileSync(path.join(__dirname, 'data/presets.json.gz')).toString('base64');
for (const [n, s] of [['jszip', jszip], ['core', core], ['threemf', threemf]]) if (/<\/script/i.test(s)) throw new Error(`${n} contains </script>`);
const head = embedded ? '' : '\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="theme-color" content="#0f6b5c">';
const pwa = embedded ? '' : [
  "try { if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js'); } catch {}",
  "try { if ('launchQueue' in window) launchQueue.setConsumer(async p => { for (const h of (p.files || [])) { const f = await h.getFile(); if (/\\.3mf$/i.test(f.name)) { showTab('projects'); openProject(f); } } }); } catch {}",
].join('\n');
// function replacers so `$` sequences in the sources are never interpreted
const html = read('src/page.html')
  .replace('/*HEAD*/', () => head)
  .replace('/*JSZIP*/', () => jszip)
  .replace('/*CORE*/', () => core)
  .replace('/*THREEMF*/', () => threemf)
  .replace('/*DATA*/', () => data)
  .replace('/*PWA*/', () => pwa);
const out = path.join(__dirname, embedded ? 'dist-embedded' : 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
if (!embedded) for (const f of fs.readdirSync(path.join(__dirname, 'public'))) fs.copyFileSync(path.join(__dirname, 'public', f), path.join(out, f));
console.log(`built ${path.relative(__dirname, out)}/index.html (${(html.length / 1024).toFixed(0)} KB)`);
