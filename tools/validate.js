#!/usr/bin/env node
/**
 * GameBoost FPS — project validator
 * Run after EVERY edit:   node tools/validate.js
 * Exits non-zero on failure. See AGENTS.md §7.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const p = f => path.join(ROOT, f);
let failures = 0;
const ok  = m => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = m => { failures++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const head = m => console.log('\n\x1b[1m' + m + '\x1b[0m');

/* ── 1. Node syntax check on main-process files ─────────────────── */
head('1. Node syntax');
for (const f of ['main.js', 'src/preload.js']) {
  try { execFileSync(process.execPath, ['--check', p(f)], { stdio: 'pipe' }); ok(f); }
  catch (e) { bad(f + ' — ' + String(e.stderr || e).split('\n').slice(0, 3).join(' ')); }
}

/* ── 2. Every <script> block parses ─────────────────────────────── */
head('2. Inline scripts parse');
const htmlFiles = ['src/index.html', 'src/splash.html'].filter(f => fs.existsSync(p(f)));
const scripts = {};
for (const f of htmlFiles) {
  const html = fs.readFileSync(p(f), 'utf8');
  const blocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  scripts[f] = blocks.map(b => b.replace(/<\/?script>/g, ''));
  let bads = 0;
  scripts[f].forEach((js, i) => {
    if (js.trim().length < 15) return;
    try { new Function(js); } catch (e) { bads++; bad(`${f} block ${i}: ${e.message.slice(0, 70)}`); }
  });
  if (!bads) ok(`${f} — ${blocks.length} block(s)`);
}

/* ── 3. CSS brace balance ───────────────────────────────────────── */
head('3. CSS brace balance');
for (const f of htmlFiles) {
  const html = fs.readFileSync(p(f), 'utf8');
  (html.match(/<style>[\s\S]*?<\/style>/g) || []).forEach((s, i) => {
    const c = s.replace(/<\/?style>/g, '');
    const o = (c.match(/{/g) || []).length, cl = (c.match(/}/g) || []).length;
    o === cl ? ok(`${f} style ${i}: ${o}/${cl}`) : bad(`${f} style ${i}: ${o}/${cl} MISMATCH`);
  });
}

/* ── 4-8. Evaluate the app script in a DOM sandbox ──────────────── */
head('4. Tweak registry');
const appJs = (scripts['src/index.html'] || []).reduce((a, b) => b.length > a.length ? b : a, '');
let R = null;
if (!appJs) { bad('could not locate the main app script'); }
else {
  const els = {};
  const el = id => els[id] || (els[id] = {
    textContent: '', className: '', innerHTML: '', value: '', disabled: false, checked: false,
    scrollTop: 0, scrollHeight: 0, firstChild: null, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, style: {}, addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, click() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => el('_q'), querySelectorAll: () => [], closest: () => null
  });
  const store = {};
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  global.document = {
    getElementById: el, querySelector: s => el(String(s).replace(/[#.\[\]="']/g, '')),
    querySelectorAll: () => [], createElement: () => el('_new' + Math.random()),
    documentElement: el('_html'), body: el('_body'), head: el('_head'),
    addEventListener() {}, execCommand: () => true
  };
  global.navigator = { clipboard: { writeText: async () => {} } };
  global.window = {
    addEventListener() {}, removeEventListener() {},
    boost: {
      isDesktop: true,
      run: async () => ({ ok: true, out: '142', err: '' }),
      sysinfo: async () => ({ cpu: 'AMD Ryzen 7 2700X', gpu: 'NVIDIA GeForce GTX 1650', ram: 16 }),
      restorePoint: async () => ({ ok: true }),
      hwStats: async () => ({ cpuLoad: 25, ramUsed: 7.5, ramTot: 16, cpuTemp: 52, gpuTemp: 58 }),
      quickPing: async () => ({ ms: 12 }),
      listGames: async () => ['FiveM'],
      overlayShow: async () => ({ ok: true }), overlayHide: async () => ({ ok: true }),
      discordSet: async () => ({ ok: true })
    }
  };
  global.setInterval = () => 1; global.clearInterval = () => {};
  global.setTimeout = () => 0;   global.clearTimeout = () => {};
  global.confirm = () => true;   global.alert = () => {};
  global.Blob = function () {};  global.URL = { createObjectURL: () => '' };
  global.btoa = s => Buffer.from(s, 'binary').toString('base64');

  try {
    R = new Function(appJs + '\n;return {T,CATS,BULK_EXCLUDE,' +
      'gpuProfile:typeof gpuProfile==="function"?gpuProfile:null,' +
      'pickAutoTweaks:typeof pickAutoTweaks==="function"?pickAutoTweaks:null};')();
    ok('app script evaluates');
  } catch (e) { bad('app script threw: ' + e.message.slice(0, 100)); }
}

if (R && Array.isArray(R.T)) {
  const T = R.T, CATS = R.CATS || {};
  ok(`${T.length} tweaks across ${new Set(T.map(t => t.cat)).size} categories`);

  const malformed = T.filter(t => !t || !t.id || !t.cat || !t.name || !Array.isArray(t.apply) ||
    (t.revert !== null && !Array.isArray(t.revert)));
  malformed.length ? bad('malformed cards: ' + malformed.map(t => (t && t.id) || '?').join(', '))
                   : ok('0 malformed cards');

  const ids = T.map(t => t.id);
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  dupes.length ? bad('duplicate ids: ' + [...new Set(dupes)].join(', ')) : ok('0 duplicate ids');

  const missing = [...new Set(T.map(t => t.cat))].filter(c => !CATS[c]);
  missing.length ? bad('categories missing a CATS label: ' + missing.join(', '))
                 : ok('every category has a CATS label');

  const emptyCmds = T.filter(t => t.apply.some(c => typeof c !== 'string' || !c.trim()));
  emptyCmds.length ? bad('empty/non-string commands in: ' + emptyCmds.map(t => t.id).join(', '))
                   : ok('all commands are non-empty strings');

  head('5. Safety guards');
  const hardcodedDns = T.filter(t => t.apply.concat(t.revert || []).some(c => /netsh[^|]*dns[^|]*"(Ethernet|Wi-Fi|Local Area Connection)"/i.test(c)));
  hardcodedDns.length ? bad('hardcoded adapter name (AGENTS.md §2.5): ' + hardcodedDns.map(t => t.id).join(', '))
                      : ok('no hardcoded network adapter names');

  const experimental = T.filter(t => t.apply.some(c => /autotuninglevel\s*=\s*experimental/i.test(c)));
  experimental.length ? bad('autotuninglevel=experimental (AGENTS.md §9.6): ' + experimental.map(t => t.id).join(', '))
                      : ok('no autotuninglevel=experimental');
}

head('6. GPU tier detection');
if (R && typeof R.gpuProfile === 'function') {
  const cases = [
    ['NVIDIA GeForce RTX 4090', 32, 'nvidia', 'high'],
    ['NVIDIA GeForce RTX 4070', 32, 'nvidia', 'high'],
    ['NVIDIA GeForce RTX 3060', 16, 'nvidia', 'mid'],
    ['NVIDIA GeForce RTX 2060', 16, 'nvidia', 'mid'],
    ['NVIDIA GeForce GTX 1650', 16, 'nvidia', 'low'],
    ['AMD Radeon RX 9070 XT', 32, 'amd', 'high'],
    ['AMD Radeon RX 7900 XTX', 32, 'amd', 'high'],
    ['AMD Radeon RX 7800 XT', 32, 'amd', 'high'],
    ['AMD Radeon RX 7600', 16, 'amd', 'mid'],
    ['AMD Radeon RX 6600', 16, 'amd', 'mid'],
    ['AMD Radeon RX 6500 XT', 16, 'amd', 'low'],
    ['AMD Radeon RX 580', 8, 'amd', 'low'],
    ['AMD Radeon(TM) Graphics', 31, 'amd', 'low'],
    ['Intel(R) Arc(TM) A770 Graphics', 16, 'intel', 'mid'],
    ['Intel(R) UHD Graphics 770', 16, 'intel', 'low']
  ];
  let miss = 0;
  cases.forEach(([gpu, ram, v, tier]) => {
    const r = R.gpuProfile({ gpu, ram });
    if (r.vendor !== v || r.tier !== tier) { miss++; bad(`${gpu} → ${r.vendor}/${r.tier} (expected ${v}/${tier})`); }
  });
  if (!miss) ok(`all ${cases.length} GPU models classified correctly`);
} else console.log('  - gpuProfile() not found, skipped');

head('7. Auto Tune vendor routing');
if (R && typeof R.pickAutoTweaks === 'function' && Array.isArray(R.T)) {
  const find = id => R.T.find(t => t.id === id);
  const nv = R.pickAutoTweaks({ cpu: 'x', gpu: 'NVIDIA GeForce RTX 4070', ram: 32 });
  const am = R.pickAutoTweaks({ cpu: 'x', gpu: 'AMD Radeon RX 6600', ram: 16 });
  const nvOK = nv.ids.some(i => (find(i) || {}).cat === 'nvidia') && !nv.ids.some(i => (find(i) || {}).cat === 'amd');
  const amOK = am.ids.some(i => (find(i) || {}).cat === 'amd') && !am.ids.some(i => (find(i) || {}).cat === 'nvidia');
  nvOK ? ok('NVIDIA machine gets nvidia cards only') : bad('NVIDIA routing wrong');
  amOK ? ok('AMD machine gets amd cards only')       : bad('AMD routing wrong');
} else console.log('  - pickAutoTweaks() not found, skipped');

/* ── summary ────────────────────────────────────────────────────── */
console.log('');
if (failures) { console.log(`\x1b[31m✗ ${failures} check(s) failed\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32m✓ all checks passed\x1b[0m\n');
