// Loads Axiom filter presets (exported JSON) and checks tokens against them.
const fs = require('fs');
const path = require('path');

const LANES = [
  { key: 'newPairs', title: 'NEW PAIRS' },
  { key: 'finalStretch', title: 'FINAL STRETCH' },
  { key: 'migrated', title: 'MIGRATED' },
];

function loadPresets(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (j.tab && j.filters) out[j.tab] = j.filters;
  }
  return out;
}

const toMinutes = (v, unit) => {
  if (v == null) return null;
  if (unit === 'hours') return v * 60;
  if (unit === 'seconds') return v / 60;
  return v;
};

const RANGE_KEYS = [
  'top10Holders', 'devHolding', 'snipers', 'insiders', 'bundle',
  'freshWalletsHoldPercent', 'holders', 'botUsers', 'bondingCurve',
  'liquidity', 'volume', 'marketCap', 'fees', 'txns',
];

// Returns the list of rules the token fails (empty = passes).
function check(f, t) {
  const fails = [];
  if (!f) return fails;
  if (f.protocols && f.protocols[t.protocol] === false) fails.push('protocol');
  const ageMax = toMinutes(f.age?.max, f.age?.maxUnit);
  const ageMin = toMinutes(f.age?.min, f.age?.minUnit);
  if (ageMax != null && t.ageMin > ageMax) fails.push('age');
  if (ageMin != null && t.ageMin < ageMin) fails.push('age');
  for (const k of RANGE_KEYS) {
    const r = f[k];
    const v = t[k];
    if (!r || v == null) continue;
    if (r.min != null && v < r.min) fails.push(k);
    if (r.max != null && v > r.max) fails.push(k);
  }
  if (f.excludeMintable && t.mintable) fails.push('mintable');
  if (f.excludeFreezable && t.freezable) fails.push('freezable');
  if (f.lpBurnt && !t.lpBurnt) fails.push('lpBurnt');
  return fails;
}

// Short human summary of the active limits of a preset, for the UI.
function summary(f) {
  if (!f) return '';
  const p = [];
  const age = toMinutes(f.age?.max, f.age?.maxUnit);
  if (age != null) p.push(`<=${age}m`);
  const lim = (k, label, suf = '%') => {
    const r = f[k];
    if (!r) return;
    if (r.max != null) p.push(`${label}<=${r.max}${suf}`);
    if (r.min != null) p.push(`${label}>=${fmtNum(r.min)}${suf}`);
  };
  lim('devHolding', 'dev');
  lim('top10Holders', 'top10');
  lim('bundle', 'bnd');
  lim('snipers', 'snp');
  lim('marketCap', 'mc', '');
  lim('liquidity', 'liq', '');
  lim('volume', 'vol', '');
  lim('botUsers', 'bots', '');
  lim('fees', 'fees', '');
  return p.join(' ');
}

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 10) / 10);
}

module.exports = { LANES, loadPresets, check, summary, fmtNum };
