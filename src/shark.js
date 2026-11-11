// Pixel shark. Wanders the lane area in any direction (never leaves the screen),
// races to coins that look about to rug, circles them, and when they rug it opens its jaws
// and eats the coin's card from one end to the other.
const { hex } = require('./canvas');

const PAL = {
  D: hex('#1E6FD9'), B: hex('#3BA7FF'), L: hex('#8FD0FF'), W: hex('#EAF6FF'), G: hex('#1A5BB8'),
  E: hex('#0B0B1A'), T: hex('#FFFFFF'), R: hex('#E0263F'), M: hex('#3A0510'),
};
// 28px wide, 14px tall (7 terminal rows via half blocks). Facing right.
const W_PX = 28, H_PX = 14;
const P = (r) => r.padEnd(W_PX, '.');
const BODY = [
  '...................D', '..................DD', '.................DBD', 'D...............DBBD',
  'DD...........DDDBBBBBB', '.DD.......DDBBBBBBBBBBBBB', '..DD....DDBBBBBLLLLBBBBBBB', '..DDDDDDBBBBBGBGBGBBBBBEBBB',
  '..DDDDDBBBBBBBBBBBBBBBBBBBBB', '.DD....BBBWWWWWWWWWWWWWWWWBB', 'DD.......WWWWWWWWWWWWWWWWW', 'D..........WWWWWWWWWWWW',
  '.............DD......D', '',
].map(P);
// jaw frames: rows 9..13
const JAW = {
  half: {
    9: P('.DD....BBBWWWWWWWWWTTTTTTTTT'), 10: P('DD.......WWWWWWWWWWTMTMTMTMT'),
    11: P('D..........WWWWWWWWMTMTMTMT'), 12: P('.............DD....WWTTTTTT'), 13: P(''),
  },
  wide: {
    9: P('.DD....BBBWWWWWWWWWTTTTTTTTT'), 10: P('DD.......WWWWWWWWWWTMTMTMTMT'),
    11: P('D..........WWWWWWWMMMRRRRMM'), 12: P('.............DD...WMTMTMTMT'), 13: P('.................WWTTTTTTTT'),
  },
};
const TAILS = [
  null,
  { 3: '.....', 4: '.D...', 5: '.DD..', 6: '..DD.', 7: '.DDDD', 8: '.DDDD', 9: '.DD..', 10: '.D...', 11: '.....' },
  { 3: '.....', 4: '.....', 5: 'DD...', 6: '.DDD.', 7: '..DDD', 8: '..DDD', 9: '.DDD.', 10: 'DD...', 11: '.....' },
  { 3: '.....', 4: '.D...', 5: '.DD..', 6: '..DD.', 7: '.DDDD', 8: '.DDDD', 9: '.DD..', 10: '.D...', 11: '.....' },
];

function frame(jaw, tail) {
  return BODY.map((row, i) => {
    let r = jaw && JAW[jaw][i] !== undefined ? JAW[jaw][i] : row;
    const t = TAILS[tail];
    if (t && t[i]) r = t[i] + r.slice(5);
    return r;
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ASPECT = 2.1; // a terminal row is ~2x taller than a column is wide
const MOUTH = 23;    // column of the jaw centre when facing right (4 when facing left)

class Shark {
  constructor(W, top, bottom) {
    this.setBounds(W, top, bottom);
    this.x = W * 0.3; this.y = top + 2;
    this.vx = 12; this.vy = 0;
    this.heading = 0;
    this.ph = [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3];
    this.dir = 1; this.tilt = 0; this.tq = 0;
    this.mode = 'wander'; // wander | stalk | hunt | eat
    this.t = 0; this.eatT = 0; this.target = null; this.stalk = null; this.orbit = 0;
    this.bubbleT = 0; this.trailT = 0; this.dropT = 0; this.sound2 = false;
    this.onBite = null;
  }

  setBounds(W, top, bottom) {
    this.W = W; this.top = top; this.bottom = bottom;
    this.minX = 0; this.maxX = W - W_PX;
    this.minY = top; this.maxY = bottom - H_PX / 2;
  }

  get speed() { return Math.hypot(this.vx, this.vy * ASPECT); }
  mouthX() { return this.x + (this.dir > 0 ? MOUTH : 4); }

  seek(tx, ty, maxSpeed, dt, arrive = 6, gain = 3) {
    const dx = tx - this.x, dy = (ty - this.y) * ASPECT, d = Math.hypot(dx, dy);
    const want = d < arrive ? maxSpeed * (d / arrive) : maxSpeed;
    const dvx = d > 0.001 ? (dx / d) * want : 0, dvy = d > 0.001 ? (dy / d) * want / ASPECT : 0;
    const k = 1 - Math.exp(-dt * gain);
    this.vx += (dvx - this.vx) * k; this.vy += (dvy - this.vy) * k;
    return d;
  }

  // where to start eating a card from, given the room on each side
  plan(card) {
    const cx = this.x + W_PX / 2, mid = card.x0 + card.w / 2;
    const fromLeft = card.x0 + 1 - MOUTH, fromRight = card.x0 + card.w - 5;
    const okL = fromLeft >= this.minX - 3, okR = fromRight <= this.maxX + 3;
    const dir = okL && okR ? (cx < mid ? 1 : -1) : okL ? 1 : -1;
    return { dir, x: clamp(dir > 0 ? fromLeft : fromRight, this.minX, this.maxX), y: card.y - 4.5 };
  }

  update(dt, ctx) {
    const { queue, dangers, fx } = ctx;
    this.t += dt;

    const job = this.mode === 'eat' ? null : queue.find((j) => j.valid());
    if (job && this.mode !== 'hunt') { this.target = job; this.mode = 'hunt'; }

    if (this.mode === 'hunt') {
      const j = this.target;
      if (!j.valid()) { this.mode = 'wander'; this.target = null; }
      else {
        const pl = this.plan(j.card());
        // swim to the start point, turning to face along the card at the end
        const d = this.seek(pl.x, pl.y, 80, dt, 5, 5);
        if (d < 12) this.dir = pl.dir; else if (Math.abs(this.vx) > 3) this.dir = Math.sign(this.vx);
        if (d < 0.9) {
          this.x = pl.x; this.y = pl.y; this.dir = pl.dir; this.vx = 0; this.vy = 0;
          this.mode = 'eat'; this.eatT = 0; this.sound2 = false;
          j.startBite(this.dir, this.mouthX());
          if (this.onBite) this.onBite();
        }
      }
    } else if (this.mode === 'eat') {
      const j = this.target, card = j.card();
      this.eatT += dt;
      this.x = clamp(this.x + this.dir * 34 * dt, this.minX, this.maxX);
      j.eat(this.mouthX());
      if (!this.sound2 && this.eatT > 0.6) { this.sound2 = true; if (this.onBite) this.onBite(); }
      // a little blood while chewing
      this.dropT += dt;
      if (this.dropT > 0.06) {
        this.dropT = 0;
        fx.push(drop(this.mouthX() - this.dir * 2, this.y + 5.5, -this.dir));
      }
      const end = this.dir > 0 ? this.mouthX() >= card.x0 + card.w - 1 || this.x >= this.maxX
        : this.mouthX() <= card.x0 + 2 || this.x <= this.minX;
      if (end || this.eatT > 3) {
        j.finishBite();
        for (let i = 0; i < 7; i++) fx.push(drop(this.mouthX(), this.y + 5, (Math.random() - 0.5) * 2));
        this.mode = 'wander'; this.target = null;
        this.heading = this.dir > 0 ? -0.4 : Math.PI + 0.4;
        this.vx = this.dir * 10;
      }
    } else {
      // nearest coin that looks about to rug
      const cx = this.x + W_PX / 2, cy = this.y + 3.5;
      let best = null, bestD = Infinity;
      for (const d of dangers) {
        const c = d.card(), px = c.x0 + c.w / 2, py = c.y + 0.5;
        const dist = Math.hypot(px - cx, (py - cy) * ASPECT);
        const reach = 30 + (d.risk - 60) * 1.6;
        const sticky = this.stalk && this.stalk.id === d.id ? 25 : 0;
        if (dist < reach + sticky && dist < bestD) { best = d; bestD = dist; }
      }
      if (best && (!this.stalk || this.stalk.id !== best.id)) { this.stalk = best; this.orbit = Math.atan2(cy - best.card().y, cx - best.card().x0) || 0; }
      if (!best) this.stalk = null;
      this.mode = this.stalk ? 'stalk' : 'wander';

      if (this.mode === 'stalk') {
        const c = this.stalk.card();
        this.orbit += dt * 1.2;
        const tx = clamp(c.x0 + c.w / 2 - W_PX / 2 + Math.cos(this.orbit) * 13, this.minX, this.maxX);
        const ty = clamp(c.y - 3 + Math.sin(this.orbit) * 2, this.minY, this.maxY);
        const far = Math.hypot(tx - this.x, (ty - this.y) * ASPECT) > 10;
        this.seek(tx, ty, far ? 60 : 22, dt, 8, far ? 3 : 2);
      } else {
        // smooth 360° wander: heading turns by a blend of slow sine waves
        const [a, b, c] = this.ph, t = this.t;
        const turn = 0.9 * Math.sin(t * 0.29 + a) + 0.55 * Math.sin(t * 0.71 + b) + 0.3 * Math.sin(t * 1.53 + c);
        this.heading += turn * dt;
        // steer away from walls well before touching them
        const mx = 14, my = 2;
        let ax = 0, ay = 0;
        if (this.x < this.minX + mx) ax += 1 - (this.x - this.minX) / mx;
        if (this.x > this.maxX - mx) ax -= 1 - (this.maxX - this.x) / mx;
        if (this.y < this.minY + my) ay += 1 - (this.y - this.minY) / my;
        if (this.y > this.maxY - my) ay -= 1 - (this.maxY - this.y) / my;
        if (ax || ay) {
          const want = Math.atan2(ay, ax);
          const diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
          this.heading += diff * Math.min(1, dt * 1.8 * Math.hypot(ax, ay));
        }
        const sp = 14 + Math.sin(t * 0.5) * 3;
        this.seek(this.x + Math.cos(this.heading) * 40, this.y + (Math.sin(this.heading) * 40) / ASPECT, sp, dt, 0.1, 2);
      }
    }

    if (this.mode !== 'eat') {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const lo = this.mode === 'hunt' ? this.minY - 5 : this.minY;
      if (this.x < this.minX) { this.x = this.minX; this.vx = Math.abs(this.vx); }
      if (this.x > this.maxX) { this.x = this.maxX; this.vx = -Math.abs(this.vx); }
      if (this.y < lo) { this.y = lo; this.vy = Math.abs(this.vy) * 0.5; }
      if (this.y > this.maxY) { this.y = this.maxY; this.vy = -Math.abs(this.vy) * 0.5; }
      if (this.mode !== 'hunt') { if (this.vx > 3) this.dir = 1; else if (this.vx < -3) this.dir = -1; }
    }

    // tilt: smooth, quantized with hysteresis so the pixels never flicker
    const slope = this.mode === 'eat' ? 0 : clamp((this.vy * 2) / Math.max(Math.abs(this.vx), 6), -0.25, 0.25);
    this.tilt += (slope - this.tilt) * (1 - Math.exp(-dt * 3));
    const step = 1 / 14;
    if (Math.abs(this.tilt - this.tq) > step * 0.75) this.tq = Math.round(this.tilt / step) * step;

    // bubbles; speed streaks when racing
    const fast = this.speed > 35;
    this.bubbleT += dt;
    if (this.bubbleT > (fast ? 0.07 : 0.28) && this.mode !== 'eat') {
      this.bubbleT = 0;
      fx.push({ x: this.x + (this.dir > 0 ? 9 : 18), y: this.y + 2, vx: -this.vx * 0.15, vy: -1.6, life: 0, max: 1.6, ch: 'o', color: hex('#9FD8FF'), bubble: true });
    }
    if (fast) {
      this.trailT += dt;
      if (this.trailT > 0.025) {
        this.trailT = 0;
        fx.push({ x: this.x + (this.dir > 0 ? 0 : W_PX - 1), y: this.y + 1.5 + Math.random() * 4, vx: -this.vx * 0.3, vy: 0, life: 0, max: 0.3, ch: '-', color: hex('#5FB8FF') });
      }
    }
  }

  jaw() {
    if (this.mode === 'eat') return ['wide', 'wide', 'half', null, 'half'][Math.floor(this.eatT * 14) % 5];
    if (this.mode === 'hunt') return Math.floor(this.t * 6) % 2 ? 'wide' : 'half';
    if (this.mode === 'stalk') return Math.floor(this.t * 1.5) % 3 === 0 ? 'half' : null;
    return null;
  }

  draw(cv, clipTop, clipBottom) {
    const racing = this.speed > 35;
    const wagHz = this.mode === 'eat' ? 10 : racing ? 12 : this.mode === 'stalk' ? 6 : 3.5;
    let rows = frame(this.jaw(), Math.floor(this.t * wagHz) % 4);
    if (this.dir < 0) rows = rows.map((r) => [...r].reverse().join(''));
    const ox = Math.round(this.x), oyPx = Math.round(this.y * 2);
    const cells = new Map();
    for (let r = 0; r < H_PX; r++) {
      for (let c = 0; c < W_PX; c++) {
        const ch = rows[r][c];
        if (ch === '.') continue;
        const py = oyPx + r + Math.round((c - W_PX / 2) * this.tq * this.dir);
        const cy = Math.floor(py / 2), key = cy * 10000 + ox + c;
        const cell = cells.get(key) || { x: ox + c, y: cy, top: null, bot: null };
        if (((py % 2) + 2) % 2 === 0) cell.top = PAL[ch]; else cell.bot = PAL[ch];
        cells.set(key, cell);
      }
    }
    for (const c of cells.values()) {
      if (c.y < clipTop || c.y >= clipBottom || c.x < 0 || c.x >= cv.W) continue;
      const under = cv.getBg(c.x, c.y);
      if (c.top && c.bot) { if (c.top === c.bot) cv.set(c.x, c.y, '█', c.top, under); else cv.set(c.x, c.y, '▀', c.top, c.bot); }
      else if (c.top) cv.set(c.x, c.y, '▀', c.top, under);
      else cv.set(c.x, c.y, '▄', c.bot, under);
    }
  }
}

function drop(x, y, side) {
  const reds = ['#FF3B5C', '#E0263F', '#B5122E', '#FF6B7F'];
  return {
    x, y, vx: side * (2 + Math.random() * 5) + (Math.random() - 0.5) * 2, vy: -0.5 - Math.random() * 1.5,
    g: 5 + Math.random() * 3, drag: true, life: 0, max: 0.8 + Math.random() * 0.6,
    ch: Math.random() < 0.6 ? '•' : '·', color: hex(reds[Math.floor(Math.random() * reds.length)]),
  };
}

module.exports = { Shark };
