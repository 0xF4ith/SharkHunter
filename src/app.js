// SHARKHUNTER screen: animated header, 3 lanes with smooth cards, agent log, positions, the shark.
const { Canvas, hex, mix, ease, clamp01 } = require('./canvas');
const { Shark } = require('./shark');
const { LANES, check, summary, fmtNum } = require('./filters');
const { score, band } = require('./risk');

const C = Object.fromEntries(Object.entries({
  ice: '#D8F1FF', shark: '#3BA7FF', fin: '#9FB8C8', white: '#FFFFFF',
  sun: '#FFC15E', sunHi: '#FFE29A', orange: '#FF8A3D', pink: '#E8577A', purple: '#6B3FA0', night: '#140B2B',
  hill: '#24123F', hill2: '#3A1B52', grass: '#5DA130', grassHi: '#7CC242', dirt: '#79553A', flowerR: '#E84A4A', flowerY: '#FFD23D',
  panel: '#0D0A1A', water: '#111A36', plate: '#140B2B', line: '#3B2A63', dim: '#7E74A3', text: '#E6E1FF',
  safe: '#3DFF8A', watch: '#FFD23D', danger: '#FF8A3D', rug: '#FF3B5C', cloud: '#FFD9E6',
}).map(([k, v]) => [k, hex(v)]));
const BAND = { SAFE: C.safe, WATCH: C.watch, DANGER: C.danger, RUG: C.rug };
const SKY = ['#140B2B', '#1F1240', '#6B3FA0', '#8E3E8A', '#E8577A', '#F06A55', '#FF8A3D', '#FF8A3D', '#FF8A3D'].map(hex);

const FONT = {
  F: ['██████', '██    ', '████  ', '██    ', '██    '],
  '4': ['██  ██', '██  ██', '██████', '    ██', '    ██'],
  I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  H: ['██  ██', '██  ██', '██████', '██  ██', '██  ██'],
};
const FIN = ['    ██', '  ████', '██████'];
const DIGITS = {
  0: ['██████', '██  ██', '██  ██', '██  ██', '██████'], 1: ['  ██  ', '████  ', '  ██  ', '  ██  ', '██████'],
  2: ['██████', '    ██', '██████', '██    ', '██████'], 3: ['██████', '    ██', '██████', '    ██', '██████'],
  4: ['██  ██', '██  ██', '██████', '    ██', '    ██'], 5: ['██████', '██    ', '██████', '    ██', '██████'],
  6: ['██████', '██    ', '██████', '██  ██', '██████'], 7: ['██████', '    ██', '    ██', '    ██', '    ██'],
  8: ['██████', '██  ██', '██████', '██  ██', '██████'], 9: ['██████', '██  ██', '██████', '    ██', '██████'],
  '.': ['  ', '  ', '  ', '  ', '██'],
  '%': ['██  ██', '   ██ ', '  ██  ', ' ██   ', '██  ██'],
};
const SPARK = ' ▁▂▃▄▅▆▇█';
const MIN_SIZE = 0.01;      // per trade
const MIN_BALANCE = 0.25;  // total balance
const MAX_SLOTS = 8;       // most trades open at once
const FIELDS = [
  { key: 'balance', n: '1', label: 'TOTAL BALANCE', unit: 'SOL', min: MIN_BALANCE, max: 10000, step: 0.05, decimals: true, maxLen: 8, color: 'shark' },
  { key: 'amount', n: '2', label: 'PER TRADE', unit: 'SOL', min: MIN_SIZE, max: 10000, step: 0.01, decimals: true, maxLen: 7, color: 'ice' },
  { key: 'maxLoss', n: '3', label: 'STOP LOSS TOTAL', unit: '%', min: 0, max: 100, step: 5, decimals: false, maxLen: 3, color: 'orange' },
];
const PARTIAL = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };
const padS = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);
const ageStr = (min) => {
  const s = Math.floor(min * 60);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};
const hillA = (x) => { const k = Math.floor(x / 2); return Math.round(1.1 + Math.sin(k / 4.3) * 0.9 + Math.sin(k / 1.7 + 1) * 0.5); };
const hillB = (x) => { const k = Math.floor(x / 2); return Math.round(0.9 + Math.sin(k / 3.1 + 2) * 0.8 + Math.sin(k / 1.3) * 0.4); };

const KIND = {
  enter: [C.shark, 'APE '], warn: [C.watch, 'WARN'], rug: [C.rug, 'FLAG'], exit: [C.orange, 'SOLD'],
  dodge: [C.safe, 'SAVE'], loss: [C.rug, 'LOSS'], rugfeed: [C.dim, 'RUG '], info: [C.dim, 'INFO'],
  tp: [C.safe, 'TP  '], sl: [C.watch, 'CUT '], stop: [C.rug, 'STOP'], eat: [C.shark, 'EAT '],
};

class App {
  constructor({ presets, agent, feed, tickMs = 1000 }) {
    Object.assign(this, { presets, agent, feed, tickMs });
    this.now = 0; this.acc = 0;
    this.slots = {}; this.disp = new Map(); this.fx = []; this.queue = [];
    this.seen = new Map(); this.lanes = []; this.bites = []; this.onBite = null;
    this.phase = 'setup'; this.setupDoneAt = null; this.fields = { balance: '1', amount: '0.05', maxLoss: '20' }; this.sel = 0; this.selAt = 0; this.err = null;
    this.tab = 'positions'; this.tabAt = 0; this.hits = []; this.eatenIds = new Set(); this.pressAt = -1e9;
    this.dstats = { scanned: 0, flagged: 0, filtered: 0, exits: 0, dodged: 0 };
    this.stars = Array.from({ length: 34 }, (_, i) => ({ x: hash(i * 7 + 1), y: Math.floor(hash(i * 13 + 5) * 2), ph: hash(i * 3) * 6.28, sp: 0.6 + hash(i * 11) * 2 }));
    this.clouds = [
      { y: 1, a: 6, b: 12, sp: 1.1, o: 10 }, { y: 2, a: 8, b: 16, sp: 0.7, o: 70 },
      { y: 4, a: 4, b: 10, sp: 1.6, o: 120 }, { y: 1, a: 10, b: 18, sp: 0.5, o: 170 },
    ];
    this.layoutFor(150, 46);
  }

  layoutFor(W, H) {
    if (this.L && this.L.W === W && this.L.H === H) return this.L;
    const bottomH = 13, laneTop = 13, statusY = H - 1, bottomTop = statusY - bottomH;
    const laneRows = bottomTop - laneTop, colW = Math.floor((W - 2) / 3);
    this.L = { W, H, bottomH, laneTop, statusY, bottomTop, laneRows, colW, maxSlots: Math.floor(laneRows / 2), colX: [0, colW + 1, 2 * (colW + 1)] };
    if (this.shark) this.shark.setBounds(W, 10, bottomTop);
    else {
      this.shark = new Shark(W, 10, bottomTop);
      this.shark.onBite = () => { this.bites.push(this.now / 1000); if (this.onBite) this.onBite(); };
    }
    return this.L;
  }

  // ---------- simulation tick ----------
  tick() {
    const events = this.feed.tick();
    const lanes = LANES.map((L) => {
      const f = this.presets[L.key];
      let filtered = 0;
      const tokens = [];
      for (const t of this.feed.tokens) {
        if (!t.dead) t.risk = score(t);
        if (t.stage !== L.key) continue;
        if (t.dead) { if (this.seen.get(t.id) === L.key) tokens.push(t); continue; }
        // filters gate ENTRY. once a coin is on the radar the shark keeps watching it.
        if (this.seen.get(t.id) === L.key || check(f, t).length === 0) { tokens.push(t); this.seen.set(t.id, L.key); } else filtered++;
      }
      tokens.sort((a, b) => b.born - a.born);
      return { ...L, tokens, filtered, live: tokens.filter((t) => !t.dead).length, summary: summary(f) };
    });
    this.agent.stats.filtered = lanes.reduce((a, L) => a + L.filtered, 0);
    this.agent.step(this.feed, Object.fromEntries(lanes.map((L) => [L.key, L.tokens])), events);
    this.lanes = lanes;
    this.syncSlots();
  }

  syncSlots() {
    const { maxSlots } = this.L;
    this.lanes.forEach((lane, li) => {
      let slots = this.slots[lane.key] || [];
      if (slots.length !== maxSlots) slots = Array.from({ length: maxSlots }, (_, i) => slots[i] || null);
      this.slots[lane.key] = slots;
      const ids = new Set(lane.tokens.map((t) => t.id));
      slots.forEach((s, i) => {
        if (!s || s.dying != null) return;
        if (!ids.has(s.token.id)) { s.dying = this.now; return; }
        if (s.token.dead && !s.queued) this.queueEat(lane, li, s, i);
        if (s.queued && !s.bitten && s.biting == null && this.now - s.deadSince > 12000) s.dying = this.now;
      });
      const placed = new Set(slots.filter(Boolean).map((s) => s.token.id));
      for (const t of lane.tokens) {
        if (t.dead || placed.has(t.id) || this.eatenIds.has(t.id)) continue;
        const free = slots.findIndex((s) => s == null);
        if (free < 0) break;
        slots[free] = { token: t, born: this.now, dying: null };
        placed.add(t.id);
      }
    });
    this.queue = this.queue.filter((j) => j.valid());
  }

  queueEat(lane, li, s, i) {
    s.queued = true; s.deadSince = this.now;
    const app = this;
    this.queue.unshift({
      slot: s,
      valid() { return app.slots[lane.key][i] === s && s.dying == null && !s.bitten; },
      card() { return { x0: app.L.colX[li], w: app.L.colW, y: app.L.laneTop + i * 2 }; },
      startBite(dir, mx) { s.biting = app.now; s.eatDir = dir; s.eatX = mx; s.eaten = new Set(); },
      eat(mx) { s.eatX = mx; },
      finishBite() {
        s.bitten = true; s.eatX = s.eatDir > 0 ? 1e9 : -1e9; s.dying = app.now - 350;
        app.eatenIds.add(s.token.id); app.agent.blocked.add(s.token.id);
        if (!s.token.dead) app.agent.say('eat', `$${s.token.ticker} went red (risk ${Math.round(s.token.risk?.score ?? 0)}). shark ate it. off the radar.`, app.feed.t);
      },
    });
  }

  // ---------- input ----------
  key(k) {
    if (this.phase === 'setup') {
      const n = FIELDS.length + 1; // + START
      if (k === 'up') this.select((this.sel + n - 1) % n);
      else if (k === 'down' || k === 'tab') this.select((this.sel + 1) % n);
      else if (k === 'enter') { if (this.sel === FIELDS.length) this.start(); else this.select(this.sel + 1); }
      else if (this.sel < FIELDS.length) {
        const F = FIELDS[this.sel];
        let v = this.fields[F.key];
        if (/^[0-9]$/.test(k) && v.length < F.maxLen) v = v === '0' ? k : v + k;
        else if (k === '.' && F.decimals && !v.includes('.')) v += '.';
        else if (k === 'backspace') v = v.slice(0, -1);
        else if (k === 'left' || k === 'right') {
          const x = (parseFloat(v) || 0) + (k === 'right' ? F.step : -F.step);
          v = String(Math.round(Math.max(F.min, Math.min(F.max, x)) * 1000) / 1000);
        }
        if (!F.decimals && parseInt(v, 10) > F.max) v = String(F.max);
        this.fields[F.key] = v;
        if (this.err && this.err.sel === this.sel) this.err = null;
      }
      return;
    }
    if (k === 'tab') this.setTab(this.tab === 'positions' ? 'pnl' : 'positions');
    if (k === 'p') this.setTab('pnl');
    if (k === 'o') this.setTab('positions');
    if (k === 's') this.toggleTrading();
    if (k === '+') this.agent.sellLine = Math.min(95, this.agent.sellLine + 5);
    if (k === '-') this.agent.sellLine = Math.max(30, this.agent.sellLine - 5);
  }

  select(i) { if (i !== this.sel) { this.sel = i; this.selAt = this.now; } }

  // validates the menu; returns an error for the first bad field
  menuError() {
    const bal = parseFloat(this.fields.balance), amt = parseFloat(this.fields.amount), ml = parseFloat(this.fields.maxLoss);
    if (!(bal >= MIN_BALANCE)) return { sel: 0, msg: `total balance: minimum is ${MIN_BALANCE} SOL` };
    if (bal > 10000) return { sel: 0, msg: 'total balance: max 10000 SOL' };
    if (!(amt >= MIN_SIZE)) return { sel: 1, msg: `per trade: minimum is ${MIN_SIZE} SOL` };
    if (amt > bal) return { sel: 1, msg: `per trade can't be more than the balance (${bal} SOL)` };
    if (!(ml >= 0 && ml <= 100) || this.fields.maxLoss === '') return { sel: 2, msg: 'stop loss total: pick 0-100%' };
    return null;
  }

  // how many trades the balance can hold at once
  slotsFor(bal, amt) { return Math.max(1, Math.min(MAX_SLOTS, Math.floor((bal + 1e-9) / amt))); }

  start() {
    const e = this.menuError();
    if (e) { this.err = { ...e, at: this.now }; this.select(e.sel); return; }
    const ag = this.agent;
    ag.balance = Math.round(parseFloat(this.fields.balance) * 1000) / 1000;
    ag.size = Math.round(parseFloat(this.fields.amount) * 1000) / 1000;
    ag.maxLossPct = Math.round(parseFloat(this.fields.maxLoss));
    ag.maxPositions = this.slotsFor(ag.balance, ag.size);
    this.phase = 'run'; this.setupDoneAt = this.now; this.acc = this.tickMs; this.pressAt = this.now;
    ag.say('info', `started: balance ${ag.balance}◎ · ${ag.size}◎ per trade · up to ${ag.maxPositions} open · stop loss total ${ag.maxLossPct}% (-${ag.lossLimit().toFixed(3)}◎).`, this.feed.t);
  }

  setTab(t) { if (t !== this.tab) { this.tab = t; this.tabAt = this.now; } }
  toggleTrading() {
    this.pressAt = this.now;
    if (this.agent.trading) this.agent.stop(this.feed.t); else this.agent.start(this.feed.t);
  }
  click(x, y) {
    for (const h of this.hits) if (y === h.y && x >= h.x0 && x < h.x1) { h.fn(); return; }
  }

  // ---------- animation ----------
  update(dt) {
    this.now += dt * 1000; this.acc += dt * 1000;
    if (this.phase !== 'run') this.acc = 0;
    while (this.acc >= this.tickMs) { this.acc -= this.tickMs; this.tick(); }
    const k = Math.min(1, dt * 6);
    for (const slots of Object.values(this.slots)) {
      slots.forEach((s, i) => {
        if (!s) return;
        if (s.dying != null && this.now - s.dying > 650) { slots[i] = null; return; }
        const t = s.token;
        let d = this.disp.get(t.id);
        if (!d) { d = { score: t.risk?.score ?? 0, mc: t.marketCap }; this.disp.set(t.id, d); }
        d.score += ((t.dead ? 100 : t.risk?.score ?? 0) - d.score) * k;
        d.mc += (t.marketCap - d.mc) * k;
      });
    }
    for (const p of this.agent.positions) {
      if (p.seenAt == null) p.seenAt = this.now; p.dpnl = (p.dpnl ?? 0) + (((p.status === 'HOLD' ? p.pnl : p.exitPnl) ?? 0) - (p.dpnl ?? 0)) * k; }
    for (const key of Object.keys(this.dstats)) this.dstats[key] += (this.agent.stats[key] - this.dstats[key]) * Math.min(1, dt * 4);
    for (const e of this.agent.log) if (e.born == null) e.born = this.now;
    this.dtot = (this.dtot ?? 0) + (this.agent.totalPnl() - (this.dtot ?? 0)) * Math.min(1, dt * 6);
    if (this.phase === 'run') this.lanes.forEach((lane, li) => (this.slots[lane.key] || []).forEach((s, i) => {
      if (!s || s.dying != null || s.queued || s.born > this.now - 300) return;
      const d = this.disp.get(s.token.id);
      if (s.token.dead || (d && band(Math.round(d.score)) === 'RUG')) this.queueEat(lane, li, s, i);
    }));
    const dangers = [];
    this.lanes.forEach((lane, li) => (this.slots[lane.key] || []).forEach((s, i) => {
      if (!s || s.dying != null || s.token.dead) return;
      const d = this.disp.get(s.token.id);
      if (d && d.score >= 65) dangers.push({ id: s.token.id, risk: d.score, card: () => ({ x0: this.L.colX[li], w: this.L.colW, y: this.L.laneTop + i * 2 }) });
    }));
    this.shark.update(dt, { queue: this.queue, dangers, fx: this.fx });
    for (const p of this.fx) {
      p.life += dt;
      if (p.g) p.vy += p.g * dt;
      if (p.drag) { const k = Math.exp(-dt * 2.5); p.vx *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.bubble) p.x += Math.sin(p.life * 6) * 0.05;
    }
    this.fx = this.fx.filter((p) => p.life < p.max);
    if (this.disp.size > 400) for (const id of [...this.disp.keys()].slice(0, 200)) this.disp.delete(id);
  }

  // ---------- drawing ----------
  render(W, H) {
    const L = this.layoutFor(W, H);
    const cv = new Canvas(W, H, C.panel);
    const t = this.now / 1000;
    this.drawHeader(cv, t);
    this.hits = [];
    this.drawLanes(cv, t);
    if (this.phase === 'run') this.drawBottom(cv, t);
    if (this.phase === 'setup' || this.now - this.setupDoneAt < 600) this.drawSetup(cv, t);
    const st = this.phase === 'setup'
      ? ` SHARKHUNTER · @0xF4ith  ·  MENU  ·  [↑/↓] select  ·  [0-9 .] type  ·  [←/→] ±0.1  ·  [enter] next / start  ·  [q] quit`
      : ` SHARKHUNTER · @0xF4ith  ·  ${this.agent.size}◎/trade  ·  [tab] positions/pnl  ·  [s] ${this.agent.trading ? 'stop' : 'start'} trading  ·  [+/-] sell line ${this.agent.sellLine}  ·  [m] sound  ·  [q] quit`;
    for (let x = 0; x < W; x++) cv.bg(x, L.statusY, C.purple);
    cv.segs(0, L.statusY, [[cut(st, W), C.ice]]);
    return cv.lines();
  }

  drawHeader(cv, t) {
    const W = cv.W, left = 3;
    for (let y = 0; y < 9; y++) for (let x = 0; x < W; x++) cv.bg(x, y, SKY[y]);
    // stars
    for (const s of this.stars) {
      const x = Math.floor(s.x * W), b = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      cv.set(x, s.y, b > 0.94 ? '+' : '·', mix(SKY[s.y], C.white, 0.15 + b * 0.6));
    }
    // sun with breathing glow
    const sunX = Math.floor(W * 0.74), pulse = 0.5 + 0.5 * Math.sin(t * 1.5);
    const sunRow = (y, w, col) => { for (let x = Math.floor(sunX - w / 2); x < sunX + w / 2; x++) cv.bg(x, y, col); };
    sunRow(3, 16, mix(SKY[3], C.sun, 0.18 + 0.12 * pulse));
    sunRow(4, 12, mix(SKY[4], C.sun, 0.45 + 0.15 * pulse));
    sunRow(4, 6, mix(C.sun, C.sunHi, pulse * 0.5));
    for (let y = 5; y <= 7; y++) sunRow(y, 10, mix(C.sun, C.sunHi, pulse * 0.4));
    // drifting blocky clouds
    for (const c of this.clouds) {
      const span = W + 40, x0 = W - ((t * c.sp * 3 + c.o) % span) + 10;
      const col = (y) => mix(SKY[y], C.cloud, 0.32);
      for (let x = Math.floor(x0 + (c.b - c.a) / 2); x < x0 + (c.b + c.a) / 2; x++) cv.bg(x, c.y, col(c.y));
      for (let x = Math.floor(x0); x < x0 + c.b; x++) cv.bg(x, c.y + 1, col(c.y + 1));
    }
    // parallax hills
    const offA = Math.floor(t * 0.8), offB = Math.floor(t * 1.8);
    for (let x = 0; x < W; x++) {
      if (hillA(x + offA) >= 2) { cv.bg(x, 7, C.hill2); }
      if (hillA(x + offA) >= 3) { cv.bg(x, 6, C.hill2); }
      cv.bg(x, 8, hillB(x + offB) >= 1 ? C.hill : C.hill2);
    }
    // sign plate
    for (let y = 3; y <= 7; y++) for (let x = 1; x < left + 82; x++) cv.bg(x, y, mix(cv.getBg(x, y), C.plate, 0.9));
    // fin
    const finA = ease((t - 1.0) / 0.5);
    for (let r = 0; r < 3; r++) [...FIN[r]].forEach((ch, k) => {
      if (ch === ' ') return;
      const x = left + 16 + k, y = r;
      cv.set(x, y, ch, mix(cv.getBg(x, y), mix(C.fin, C.ice, r / 3), finA));
    });
    // F4ITH: letters drop in, then a shimmer sweeps across every few seconds
    const sweep = ((t * 22) % 90) - 15;
    [...'F4ITH'].forEach((Lt, i) => {
      const a = ease((t - 0.2 - i * 0.18) / 0.4);
      const dy = Math.round((1 - a) * -2);
      for (let r = 0; r < 5; r++) [...FONT[Lt][r]].forEach((ch, k) => {
        if (ch === ' ') return;
        const x = left + i * 8 + k, y = 3 + r + dy;
        if (y < 3) return;
        const kx = i * 8 + k + r * 1.5;
        const shine = Math.max(0, 1 - Math.abs(kx - sweep) / 3.5);
        const base = mix(C.ice, C.shark, r / 4);
        cv.set(x, y, '█', mix(cv.getBg(x, y), mix(base, C.white, shine * 0.85), a));
      });
    });
    // info, typed in
    const info = [
      [['SHARKHUNTER', C.ice, true], [' v0.6', C.fin]],
      [['axiom × claude agents · rug radar', C.text]],
      [['@0xF4ith', mix(C.shark, C.ice, 0.5 + 0.5 * Math.sin(t * 2))]],
      [['the shark doesn\'t sleep.', C.fin]],
    ];
    let budget = Math.max(0, (t - 1.2) * 45);
    info.forEach((segs, i) => {
      const len = segs.reduce((a, s) => a + [...s[0]].length, 0);
      const end = cv.segs(left + 42, 3 + i, segs, { max: Math.floor(budget) });
      if (i === 3 && budget >= len && Math.floor(t * 2) % 2 === 0) cv.set(end, 6, '▌', C.shark);
      budget -= len;
    });
    // grass with drifting flowers
    for (let x = 0; x < W; x++) {
      const k = x + offB;
      const h = hash(k * 31 + 7);
      const col = h < 0.025 ? C.flowerR : h < 0.05 ? C.flowerY : k % 7 === 3 ? C.grassHi : C.grass;
      cv.set(x, 9, '▀', col, C.dirt);
    }
  }

  waterBg(x, y, t) {
    const w = y >= this.L.laneTop ? 0.18 + 0.18 * Math.sin(x * 0.13 + y * 0.5 + t * 1.1) * Math.sin(x * 0.05 - t * 0.6) : 0;
    return mix(C.panel, C.water, w);
  }

  drawLanes(cv, t) {
    const L = this.L, W = cv.W;
    // water shimmer behind the lanes
    for (let y = 10; y < L.bottomTop; y++) for (let x = 0; x < W; x++) {
      cv.bg(x, y, this.waterBg(x, y, t));
    }
    const sepX = [L.colW, 2 * L.colW + 1];
    if (this.phase === 'run') {
      for (let y = 10; y < L.bottomTop; y++) for (const x of sepX) cv.set(x, y, '│', C.line);
      for (let x = 0; x < W; x++) cv.set(x, 12, '─', C.line);
    }
    if (this.phase === 'run') this.lanes.forEach((lane, li) => {
      const x0 = L.colX[li];
      cv.segs(x0 + 1, 10, [[lane.title, C.ice, true], [`  ${lane.live} live · ${lane.filtered} filtered`, C.dim]], { clipR: x0 + L.colW });
      cv.segs(x0 + 1, 11, [[cut(lane.summary, L.colW - 2), C.line]]);
      (this.slots[lane.key] || []).forEach((s, i) => { if (s) this.drawCard(cv, x0, L.laneTop + i * 2, L.colW, s, t); });
    });
    // fx below the shark: bubbles; above: blood
    const drawFx = (above) => { for (const p of this.fx) {
      if (!!p.above !== above || p.y < 8 || p.y >= L.bottomTop) continue;
      const a = 1 - p.life / p.max;
      const ch = p.bubble ? (p.life < 0.5 ? 'o' : p.life < 1.1 ? '°' : '·') : p.ch;
      cv.set(p.x, p.y, ch, mix(cv.getBg(p.x, p.y), p.color, a), null, p.bold);
    } };
    drawFx(false);
    this.shark.draw(cv, 0, L.bottomTop);
    drawFx(true);
    if (this.shark.mode === 'eat') {
      const sh = this.shark, bx = Math.round(sh.x + (sh.dir > 0 ? 6 : 13)), by = Math.round(sh.y) > 10 ? Math.round(sh.y) - 1 : Math.round(sh.y) + 7;
      const hot = Math.floor(this.now / 120) % 2 === 0;
      cv.segs(bx, by, [[' CHOMP! ', C.white, true, hot ? C.rug : mix(C.rug, C.white, 0.3)]]);
    }
  }

  drawCard(cv, x0, y, w, s, t) {
    const tk = s.token, d = this.disp.get(tk.id) || { score: 0, mc: tk.marketCap };
    const age = (this.now - s.born) / 1000;
    let a = ease(age / 0.5);
    if (s.dying != null) a *= 1 - ease((this.now - s.dying) / 650);
    const off = Math.round((1 - ease(age / 0.5)) * 6);
    const clip = { alpha: a, clipL: x0, clipR: x0 + w };
    const x = x0 + off;
    const held = this.agent.positions.some((p) => p.token === tk && p.status === 'HOLD');
    const sc = Math.round(d.score), b = tk.dead ? 'RUG' : band(sc), col = BAND[b];
    cv.segs(x + 1, y, [
      [held ? '◆' : ' ', C.shark], [padS(cut('$' + tk.ticker, 11), 11), C.text, true],
      [' mc ', C.dim], [padS('$' + fmtNum(d.mc), 8), C.text], [padS(ageStr(tk.ageMin), 8), C.dim], [cut(tk.protocol, Math.max(1, w - 41)), C.dim],
    ], clip);
    if (tk.dead) {
      const flash = Math.floor(t * 4) % 2 === 0 ? C.rug : mix(C.rug, C.white, 0.25);
      cv.segs(x + 2, y + 1, [[` RUGGED -${tk.rugDrop.toFixed(0)}% `, C.white, true, flash], [tk.lpPulled ? ' LP pulled' : ' dev dumped', C.rug]], clip);
    } else {
      const n = 10, v = (d.score / 100) * n, full = Math.floor(v), part = Math.floor((v - full) * 8);
      for (let i = 0; i < n; i++) {
        const cx = x + 2 + i;
        if (cx < x0 || cx >= x0 + w) continue;
        const under = cv.getBg(cx, y + 1);
        if (i < full) cv.set(cx, y + 1, '█', mix(under, col, a));
        else if (i === full && part > 0) cv.set(cx, y + 1, PARTIAL[part], mix(under, col, a));
        else cv.set(cx, y + 1, '░', mix(under, C.line, a));
      }
      cv.segs(x + 13, y + 1, [[padS(String(sc), 4), col], [padS(b, 7), col, true],
        [`dev ${tk.devHolding.toFixed(0)} bnd ${tk.bundle.toFixed(0)} snp ${tk.snipers.toFixed(0)}`, C.dim]], clip);
    }
    // being eaten: everything the jaws have passed is gone; the bits fly off as crumbs
    if (s.eatX != null) {
      for (let r = 0; r < 2; r++) for (let cx = x0; cx < x0 + w; cx++) {
        const gone = s.eatDir > 0 ? cx < s.eatX : cx > s.eatX;
        if (!gone) continue;
        const i = cv.idx(cx, y + r);
        if (i < 0) continue;
        const key = r * 1000 + cx;
        if (!s.eaten.has(key)) {
          s.eaten.add(key);
          const h = hash(key * 13 + tk.id);
          if (cv.ch[i] !== ' ' && h < 0.35) {
            this.fx.push({ x: cx - s.eatDir, y: y + r, vx: -s.eatDir * (10 + hash(key) * 14), vy: -2 - hash(key * 7) * 3, g: 9, drag: true,
              life: 0, max: 0.35 + hash(key * 3) * 0.3, ch: h < 0.12 ? cv.ch[i] : (h < 0.24 ? '·' : ','), color: cv.f[i], above: true });
          }
        }
        cv.ch[i] = ' '; cv.b[i] = this.waterBg(cx, y + r, t);
      }
    }
  }

  drawBottom(cv, t) {
    const L = this.L, W = cv.W;
    for (let x = 0; x < W; x++) cv.set(x, L.bottomTop, '─', C.line);
    const logW = Math.floor(W * 0.62), y0 = L.bottomTop + 1;
    for (let y = y0; y < L.statusY; y++) cv.set(logW, y, '│', C.line);
    const ag = this.agent;
    cv.segs(1, y0, [['CLAUDE AGENT', C.ice, true], [ag.mode === 'claude' ? '  · live claude verdicts' : '  · rules engine', C.dim]]);
    const recent = ag.log.slice(-(L.bottomH - 2));
    recent.forEach((e, i) => {
      const [col, tag] = KIND[e.kind] || KIND.info;
      const typed = Math.floor((this.now - (e.born ?? this.now)) / 9);
      const fresh = clamp01((this.now - (e.born ?? 0)) / 400);
      const ts = `${String(Math.floor(e.tick * 10 / 60)).padStart(2, '0')}:${String((e.tick * 10) % 60).padStart(2, '0')} `;
      let x = cv.segs(1, y0 + 1 + i, [[ts, C.line], [tag, col, true], [' ', C.text], [e.src === 'claude' ? '◆' : ' ', C.shark]], { alpha: fresh });
      x = cv.segs(x, y0 + 1 + i, [[cut(e.text, logW - 18), e.kind === 'rugfeed' ? C.dim : C.text]], { max: typed });
      if (typed < [...e.text].length && Math.floor(t * 8) % 2 === 0) cv.set(x, y0 + 1 + i, '▌', C.shark);
    });
    // right panel: tabs
    const px = logW + 2, pw = W - px - 1;
    const tabs = [['positions', ' POSITIONS '], ['pnl', ' PNL ']];
    let tx = px;
    for (const [id, label] of tabs) {
      const on = this.tab === id;
      const end = cv.segs(tx, y0, [[label, on ? C.panel : C.dim, true, on ? C.ice : null]]);
      this.hits.push({ x0: tx, x1: end, y: y0, fn: () => this.setTab(id) });
      tx = end + 1;
    }
    cv.segs(tx + 1, y0, [[(this.dtot >= 0 ? '+' : '') + this.dtot.toFixed(3) + '◎', this.dtot >= 0 ? C.safe : C.rug, true], [ag.trading ? '' : '  stopped', C.rug, true]]);
    const ta = ease((this.now - this.tabAt) / 300), slide = Math.round((1 - ta) * 4);
    if (this.tab === 'positions') this.drawPositions(cv, px + slide, y0, pw, ta);
    else this.drawPnl(cv, px + slide, y0, pw, ta, t);
  }

  drawPositions(cv, px, y0, pw, ta) {
    const ag = this.agent, L = this.L;
    const label = { HOLD: 'HOLD', RISK: 'SOLD', TP: 'TP', SL: 'CUT', TRAIL: 'TRAIL', STOP: 'CLOSED', RUGGED: 'RUGGED' };
    const color = { HOLD: C.shark, RISK: C.orange, TP: C.safe, SL: C.watch, TRAIL: C.safe, STOP: C.dim, RUGGED: C.rug };
    ag.positions.slice(-7).forEach((p, i) => {
      const tk = p.token, pnl = p.dpnl ?? 0;
      const a = ease((this.now - (p.seenAt ?? this.now - 1000)) / 500) * ta;
      const sol = p.size * pnl / 100;
      cv.segs(px, y0 + 1 + i, [[padS(cut('$' + tk.ticker, 11), 11), C.text], [padS(` ${p.size}◎`, 7), C.dim],
        [padS((pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%', 8), pnl >= 0 ? C.safe : C.rug],
        [padS((sol >= 0 ? '+' : '') + sol.toFixed(3), 8), pnl >= 0 ? C.safe : C.rug],
        [padS('r' + (tk.dead ? '--' : String(tk.risk?.score ?? 0)), 4), C.dim], [label[p.status] || p.status, color[p.status] || C.dim, true]], { alpha: a });
    });
    if (!ag.positions.length) cv.segs(px, y0 + 2, [[ag.trading ? 'scanning for clean entries…' : 'trading stopped. [s] to start.', C.dim]], { alpha: ta });
    const s = this.dstats, R = Math.round;
    for (let x = px; x < px + pw; x++) cv.set(x, L.statusY - 3, '─', C.line);
    cv.segs(px, L.statusY - 2, [['scanned ', C.dim], [padS(String(R(s.scanned)), 6), C.text], ['flagged ', C.dim], [padS(String(R(s.flagged)), 5), C.watch], ['filtered ', C.dim], [String(R(s.filtered)), C.text]], { alpha: ta });
    cv.segs(px, L.statusY - 1, [['exits   ', C.dim], [padS(String(R(s.exits)), 6), C.orange], ['rugs dodged ', C.dim], [String(R(s.dodged)), C.safe, true]], { alpha: ta });
  }

  drawPnl(cv, px, y0, pw, ta, t) {
    const ag = this.agent, L = this.L, Lg = ag.ledger, o = { alpha: ta };
    const tot = this.dtot ?? 0, real = Lg.realized, unreal = ag.unrealized();
    const sgn = (v, d = 3) => (v >= 0 ? '+' : '') + v.toFixed(d);
    const col = (v) => (v >= 0 ? C.safe : C.rug);
    const open = ag.positions.filter((p) => p.status === 'HOLD').length;
    const eqv = ag.balance + tot;
    cv.segs(px, y0 + 1, [['balance ', C.dim], [ag.balance + '◎', C.text], [' → ', C.line], [eqv.toFixed(3) + '◎', col(tot), true], [' · cash ', C.dim], [ag.cash().toFixed(3) + '◎', C.text]], o);
    cv.segs(px, y0 + 2, [['TOTAL PNL  ', C.dim], [padS(sgn(tot) + ' SOL', 16), col(tot), true], ag.paper ? [' PAPER ', C.panel, true, C.watch] : [' LIVE ', C.white, true, C.rug]], o);
    cv.segs(px, y0 + 3, [['realized   ', C.dim], [padS(sgn(real) + '◎', 10), col(real)], [' open ', C.dim], [sgn(unreal) + '◎', col(unreal)], [' in ', C.dim], [ag.deployed().toFixed(2) + '◎', C.shark]], o);
    const wr = Lg.trades ? Math.round((Lg.wins / Lg.trades) * 100) : 0;
    cv.segs(px, y0 + 4, [['trades ', C.dim], [String(Lg.trades), C.text], ['  W ', C.dim], [String(Lg.wins), C.safe], ['  L ', C.dim], [String(Lg.losses), C.rug], ['  win rate ', C.dim], [wr + '%', C.text, true]], o);
    cv.segs(px, y0 + 5, [['best ', C.dim], [sgn(Lg.best, 1) + '%', C.safe], ['  worst ', C.dim], [sgn(Lg.worst, 1) + '%', C.rug], ['  open ', C.dim], [String(open), C.shark], [' × ', C.dim], [ag.size + '◎', C.text]], o);
    const lim = ag.lossLimit(), used = lim > 0 ? clamp01(-Math.min(0, tot) / lim) : (tot < 0 ? 1 : 0), bw = 12;
    cv.segs(px, y0 + 6, [['loss limit ', C.dim], ['█'.repeat(Math.round(used * bw)), mix(C.watch, C.rug, used)], ['░'.repeat(bw - Math.round(used * bw)), C.line], [` -${lim.toFixed(3)}◎ · ${Math.round(used * 100)}% used`, C.dim]], o);
    // equity curve: 2 rows of 8-level blocks
    const eq = ag.equity.slice(-(pw - 2));
    if (eq.length > 1) {
      const lo = Math.min(0, ...eq), hi = Math.max(0, ...eq), span = hi - lo || 1;
      eq.forEach((v, i) => {
        const lvl = Math.round(((v - lo) / span) * 16), c = v >= 0 ? C.safe : C.rug;
        const x = px + i;
        const bot = Math.min(8, lvl), top = Math.max(0, lvl - 8);
        cv.set(x, y0 + 9, bot ? SPARK[bot] : ' ', mix(C.panel, c, ta * (0.6 + 0.4 * (i / eq.length))));
        if (top) cv.set(x, y0 + 8, SPARK[top], mix(C.panel, c, ta * (0.6 + 0.4 * (i / eq.length))));
      });
    } else cv.segs(px, y0 + 8, [['equity curve shows up after the first trades', C.line]], o);
    // STOP / START button
    const pressed = this.now - this.pressAt < 180;
    const on = ag.trading;
    const label = on ? '  ■  STOP TRADING  ' : '  ▶  START TRADING  ';
    const base = on ? C.rug : C.safe;
    const pulse = on ? 0 : 0.15 + 0.15 * Math.sin(t * 4);
    const bg = pressed ? mix(base, C.white, 0.35) : mix(base, C.white, pulse);
    const by = L.statusY - 2;
    const end = cv.segs(px, by, [[label, on ? C.white : C.panel, true, bg]], o);
    cv.segs(end + 1, by, [['[s]', C.dim]], o);
    cv.segs(px, L.statusY - 1, [[on ? 'closes every open position, keeps the shark on watch' : 'paused. no new entries. shark still guarding.', C.line]], o);
    this.hits.push({ x0: px, x1: end, y: by, fn: () => this.toggleTrading() });
  }

  drawSetup(cv, t) {
    const L = this.L, W = cv.W;
    const fade = this.phase === 'setup' ? ease((t - 1.4) / 0.6) : 1 - ease((this.now - this.setupDoneAt) / 600);
    if (fade <= 0) return;
    const bw = 88, bh = 28, bx = Math.floor((W - bw) / 2), by = 11 + Math.max(0, Math.floor((L.statusY - 11 - bh) / 2));
    const o = { alpha: fade };
    const plate = (x, y, col, k = 1) => cv.bg(x, y, mix(cv.getBg(x, y), col, k * fade));
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) { const i = cv.idx(x, y); if (i >= 0 && fade > 0.5) cv.ch[i] = ' '; plate(x, y, C.plate, 0.94); }
    const edge = mix(C.line, C.shark, 0.5 + 0.5 * Math.sin(t * 2));
    for (let x = bx; x < bx + bw; x++) { cv.set(x, by, '▀', mix(cv.getBg(x, by), edge, fade)); cv.set(x, by + bh - 1, '▄', mix(cv.getBg(x, by + bh - 1), edge, fade)); }
    for (let y = by; y < by + bh; y++) { cv.set(bx, y, '█', mix(cv.getBg(bx, y), edge, fade)); cv.set(bx + bw - 1, y, '█', mix(cv.getBg(bx + bw - 1, y), edge, fade)); }
    cv.segs(bx + 4, by + 2, [['SHARKHUNTER', C.ice, true], ['  ·  ', C.line], ['MENU', C.shark, true]], o);
    cv.segs(bx + bw - 30, by + 2, [['set it up, then hit START', C.dim]], o);

    const errOn = this.err && this.now - this.err.at < 2000;
    const shakeOf = (i) => (errOn && this.err.sel === i ? Math.round(Math.sin((this.now - this.err.at) / 30) * 2 * (1 - (this.now - this.err.at) / 2000)) : 0);
    const selA = ease((this.now - this.selAt) / 250);
    const bal = parseFloat(this.fields.balance) || 0, amt = parseFloat(this.fields.amount) || 0, mlp = parseFloat(this.fields.maxLoss) || 0;
    const slots = amt > 0 ? this.slotsFor(bal, amt) : 0;
    const fieldBad = (F, v) => {
      const x = parseFloat(v);
      if (!(x >= F.min) || !(x <= F.max) || v === '') return true;
      return F.key === 'amount' && x > bal;
    };
    const hint = (F) => F.key === 'balance' ? `min ${MIN_BALANCE} · what the bot can trade with`
      : F.key === 'amount' ? (amt > bal && bal ? `more than the balance` : `min ${MIN_SIZE} · ${amt > 0 ? `${Math.floor((bal + 1e-9) / amt)} trades fit, ${slots} open at once` : 'size of each entry'}`)
      : '';
    FIELDS.forEach((F, i) => {
      const y = by + 5 + i * 3, on = this.sel === i, sh = shakeOf(i);
      const v = this.fields[F.key], bad = fieldBad(F, v);
      if (on) for (let x = bx + 3; x < bx + bw - 3; x++) { plate(x, y - 1, C.water, 0.9 * selA); plate(x, y, C.water, 0.9 * selA); plate(x, y + 1, C.water, 0.9 * selA); }
      if (on) for (let r = -1; r <= 1; r++) cv.set(bx + 3, y + r, '▌', mix(cv.getBg(bx + 3, y + r), C.shark, fade));
      const arrow = on ? (Math.floor(t * 3) % 2 ? '▶ ' : '▷ ') : '  ';
      const valCol = errOn && this.err.sel === i ? C.rug : bad ? mix(C.dim, C.rug, 0.4) : on ? C.ice : C.text;
      const caret = on && Math.floor(t * 2.2) % 2 === 0 ? '▌' : ' ';
      const pct = F.unit === '%';
      cv.segs(bx + 5 + sh, y, [[arrow, C.shark, true], [F.n + '  ', on ? C.shark : C.dim, true], [padS(F.label, 17), on ? C.ice : C.text, true],
        [padS((v || '') + caret, pct ? 4 : 9), valCol, true], [pct ? '%  ' : 'SOL   ', C.dim], [hint(F), on ? C.dim : C.line]], o);
      if (pct) {
        const p = clamp01(mlp / 100), sw = 22, sx = bx + 37;
        for (let k = 0; k < sw; k++) {
          const filled = k < Math.round(p * sw);
          cv.set(sx + k, y, filled ? '█' : '░', mix(cv.getBg(sx + k, y), filled ? mix(C.watch, C.rug, k / sw) : C.line, fade));
        }
        cv.segs(sx + sw + 2, y, [[`stops at -${(bal * mlp / 100).toFixed(3)}◎`, on ? C.text : C.dim]], o);
        cv.segs(bx + 34, y + 1, [[`of the total balance (${bal || '?'} SOL)`, C.line]], o);
      }
    });

    // START button (3 rows tall)
    const sy = by + 14, onS = this.sel === FIELDS.length;
    const pressed = this.phase !== 'setup' && this.now - this.setupDoneAt < 250;
    const pulse = onS ? 0.12 + 0.12 * Math.sin(t * 5) : 0;
    const base = onS ? C.safe : mix(C.safe, C.plate, 0.65);
    const btn = pressed ? mix(base, C.white, 0.5) : mix(base, C.white, pulse);
    const sw = 26, sx = bx + Math.floor((bw - sw) / 2);
    for (let r = 0; r < 3; r++) for (let x = sx; x < sx + sw; x++) plate(x, sy + r, btn, 1);
    cv.segs(sx + Math.floor((sw - 11) / 2), sy + 1, [[onS ? '▶  START  ◀' : '   START   ', onS ? C.panel : C.text, true]], o);
    this.hits.push({ x0: sx, x1: sx + sw, y: sy + 1, fn: () => { this.select(FIELDS.length); this.start(); } });
    FIELDS.forEach((_, i) => this.hits.push({ x0: bx + 3, x1: bx + bw - 3, y: by + 5 + i * 3, fn: () => this.select(i) }));

    // big readout of the selected field, or the plan when START is selected
    const dy = by + 18;
    if (this.sel < FIELDS.length) {
      const F = FIELDS[this.sel], v = this.fields[F.key] || '0', bad = fieldBad(F, v);
      const dcol = errOn && this.err.sel === this.sel ? C.rug : bad ? mix(C.dim, C.rug, 0.3) : C[F.color];
      let x = bx + 6 + shakeOf(this.sel);
      for (const ch of v + (F.unit === '%' ? '%' : '')) {
        const g = DIGITS[ch]; if (!g) continue;
        for (let r = 0; r < 5; r++) [...g[r]].forEach((c, k) => { if (c !== ' ') cv.set(x + k, dy + r, '█', mix(cv.getBg(x + k, dy + r), mix(C.ice, dcol, 0.3 + r * 0.15), fade)); });
        x += g[0].length + 1;
      }
      const label = { balance: [['SOL', C.ice, true], ['  total balance', C.dim]], amount: [['SOL', C.ice, true], ['  per trade', C.dim]], maxLoss: [['max total loss', C.dim], ['  0-100%', C.line]] }[F.key];
      cv.segs(x + 2, dy + 4, label, o);
    } else {
      cv.segs(bx + 6, dy, [['PLAN', C.ice, true]], o);
      cv.segs(bx + 6, dy + 1, [[`balance ${bal} SOL · ${amt} SOL per trade · up to ${slots} open · stops at -${(bal * mlp / 100).toFixed(3)} SOL (${mlp}%)`, C.text]], o);
      cv.segs(bx + 6, dy + 2, [[`take profit +${this.agent.takeProfit}% · stop loss ${this.agent.stopLoss}% · trailing ${this.agent.trail}% after +${this.agent.trailFrom}%`, C.text]], o);
      cv.segs(bx + 6, dy + 3, [[`exit on risk ≥ ${this.agent.sellLine} · anything red gets eaten on sight`, C.text]], o);
    }
    const e = this.menuError();
    cv.segs(bx + 4, by + 24, errOn ? [['✖ ', C.rug, true], [this.err.msg, C.rug, true]]
      : e ? [['✖ ', mix(C.dim, C.rug, 0.5)], [e.msg, mix(C.dim, C.rug, 0.5)]]
      : [['✔ ', C.safe, true], ['ready. ', C.safe], [this.sel === FIELDS.length ? 'press enter to start' : 'enter → next', C.text]], o);
    const F = FIELDS[this.sel];
    const keys = F ? `[↑/↓] select   [0-9${F.decimals ? ' .' : ''}] type   [←/→] ±${F.step}${F.unit === '%' ? '%' : ''}   [enter] next / start   or click` : '[↑/↓] select   [enter] start   or click';
    cv.segs(bx + 4, by + 25, [[keys, C.line]], o);
  }
}

module.exports = { App };
