#!/usr/bin/env node
// SHARKHUNTER — terminal rug radar. axiom filter presets × claude agents.  @0xF4ith
const path = require('path');
const { loadPresets } = require('./filters');
const { DemoFeed } = require('./feed');
const { Agent } = require('./agent');
const { App } = require('./app');
const sound = require('./sound');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

// a seed makes every run (feed + shark) repeatable, handy for recording
if (opt('seed')) { let a = +opt('seed') * 7919; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const fs = require('fs');
// your own Axiom presets: drop a "filters" folder next to the app to override the built-in ones
const besideApp = path.join(path.dirname(process.pkg ? process.execPath : path.join(__dirname, '..', 'x')), 'filters');
const presetDir = opt('filters', process.pkg && fs.existsSync(besideApp) ? besideApp : path.join(__dirname, '..', 'filters'));
const presets = loadPresets(presetDir);
const agent = new Agent({ sellLine: +opt('sell-line', 70), size: +opt('size', 0.5) });
const feed = new DemoFeed(+opt('seed', Date.now() % 1e9));
const app = new App({ presets, agent, feed, tickMs: +opt('tick', 1000) });
const FPS = +opt('fps', 30);

agent.say('info', `loaded ${Object.keys(presets).length} axiom presets: ${Object.keys(presets).join(', ')}. sell line ${agent.sellLine}.`, 0);
agent.say('info', agent.mode === 'claude' ? `claude online (${agent.model}). the shark is awake.` : 'rules engine online. the shark is awake.', 0);

// scripted input for recordings: [seconds, key]
const SCRIPT = [
  [1.9, 'backspace'], [2.2, '0'], [2.4, '.'], [2.6, '2'], [2.8, '5'],                 // balance 0.25
  [3.4, 'down'], [4.0, 'backspace'], [4.4, '3'],                                    // per trade 0.03
  [5.0, 'down'], [5.4, 'backspace'], [5.6, 'backspace'], [5.9, '1'], [6.1, '5'],    // stop loss 15%
  [6.7, 'down'], [7.4, 'enter'],
  [27, 'tab'], [37, 'tab'], [48, 'tab'], [53, 's'],
];

// --record SECONDS [--warm SECONDS] : print frames at FPS separated by \f (for video)
if (flag('record') || flag('snapshot')) {
  const W = +opt('width', 150), H = +opt('height', 46);
  const warm = +opt('warm', flag('snapshot') ? opt('snapshot', 60) : 40);
  const secs = flag('snapshot') ? 0 : +opt('record', 30);
  const dt = 1 / FPS;
  const script = flag('no-script') ? [] : SCRIPT.slice();
  if (opt('size') || opt('balance')) { if (opt('balance')) app.fields.balance = String(opt('balance')); if (opt('size')) app.fields.amount = String(opt('size')); if (opt('max-loss')) app.fields.maxLoss = String(opt('max-loss')); app.start(); }
  const advance = () => {
    app.update(dt);
    while (script.length && app.now / 1000 >= script[0][0]) app.key(script.shift()[1]);
  };
  for (let i = 0; i < warm * FPS; i++) advance();
  const frames = [app.render(W, H).join('\n')];
  for (let i = 0; i < secs * FPS; i++) { advance(); frames.push(app.render(W, H).join('\n')); }
  process.stdout.write(frames.join('\f'));
  if (opt('events')) require('fs').writeFileSync(opt('events'), JSON.stringify(app.bites.map((b) => b - warm)));
  process.exit(0);
}

let muted = flag('mute');
app.onBite = () => sound.bite({ muted });
if (opt('size') || opt('balance')) { if (opt('balance')) app.fields.balance = String(opt('balance')); if (opt('size')) app.fields.amount = String(opt('size')); if (opt('max-loss')) app.fields.maxLoss = String(opt('max-loss')); app.start(); }
const out = process.stdout;
const NEED_W = 150, NEED_H = 46;
// try to grow the window to fit (double-clicked apps open in small default windows)
if ((out.columns || 0) < NEED_W || (out.rows || 0) < NEED_H) {
  if (process.platform === 'win32' && !process.env.WT_SESSION) {
    try { require('child_process').spawnSync('cmd', ['/c', `mode con: cols=${NEED_W + 2} lines=${NEED_H + 2}`], { stdio: 'inherit' }); } catch { /* ignore */ }
  } else out.write(`\x1b[8;${NEED_H + 2};${NEED_W + 2}t`);
}
const crash = (err) => {
  try { out.write('\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l'); } catch { /* ignore */ }
  console.error('\nSharkHunter crashed:\n', err && err.stack || err, '\n\npress enter to close');
  try { process.stdin.setRawMode && process.stdin.setRawMode(false); } catch { /* ignore */ }
  process.stdin.resume(); process.stdin.once('data', () => process.exit(1));
};
process.on('uncaughtException', crash);
out.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1000h\x1b[?1006h');
const quit = () => { out.write('\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l'); process.exit(0); };
process.on('SIGINT', quit);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (d) => {
    let s = d.toString();
    // mouse clicks (SGR): ESC [ < b ; x ; y M
    s = s.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (_, b, x, y, m) => { if (m === 'M' && +b === 0) app.click(+x - 1, +y - 1); return ''; });
    const keys = { '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\r': 'enter', '\n': 'enter', '\x7f': 'backspace', '\b': 'backspace', '\t': 'tab', '=': '+' };
    for (const [seq, name] of Object.entries(keys)) if (s === seq) { app.key(name); return; }
    for (const k of s) {
      if (k === 'q' || k === '\u0003') quit();
      if (k === 'm') { muted = !muted; continue; }
      app.key(keys[k] || k);
    }
  });
}
function tooSmall(w, h) {
  const msg = ['SHARKHUNTER', '', 'make this window bigger', `(${w}×${h} now, needs at least 120×36, best 150×46)`, '', 'maximize it, or zoom the font out with ctrl/cmd + minus', '', '[q] quit'];
  const lines = [];
  for (let y = 0; y < h; y++) {
    const m = msg[y - Math.floor((h - msg.length) / 2)] || '';
    const pad = Math.max(0, Math.floor((w - m.length) / 2));
    lines.push('\x1b[48;5;234m\x1b[38;5;' + (m === 'SHARKHUNTER' ? '75' : '252') + 'm' + (' '.repeat(pad) + m).padEnd(w).slice(0, w) + '\x1b[0m');
  }
  return lines;
}
let prev = [], last = Date.now(), size = '';
setInterval(() => {
  const now = Date.now();
  app.update(Math.min(0.25, (now - last) / 1000)); last = now;
  const cw = out.columns || 150, ch = out.rows || 46;
  const small = cw < 120 || ch < 36;
  const W = small ? cw : cw, H = small ? ch : ch;
  if (`${W}x${H}${small}` !== size) { size = `${W}x${H}${small}`; prev = []; out.write('\x1b[2J'); }
  const lines = small ? tooSmall(cw, ch) : app.render(W, H);
  let buf = '';
  lines.forEach((l, y) => { if (l !== prev[y]) buf += `\x1b[${y + 1};1H` + l; });
  prev = lines;
  if (buf) out.write(buf);
}, 1000 / FPS);
