// Tiny cell canvas: every frame is drawn into a grid, then serialized to ANSI lines.
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const mix = (a, b, k) => { k = clamp01(k); return [a[0] + (b[0] - a[0]) * k | 0, a[1] + (b[1] - a[1]) * k | 0, a[2] + (b[2] - a[2]) * k | 0]; };
const ease = (k) => { k = clamp01(k); return 1 - Math.pow(1 - k, 3); };

const TRUECOLOR = !(process.env.TERM_PROGRAM === 'Apple_Terminal' && !/truecolor|24bit/i.test(process.env.COLORTERM || '')) && !process.env.SHARKHUNTER_256;
const lvl = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
function to256(c) {
  const [r, g, b] = c;
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) { // greys
    if (r < 8) return 16; if (r > 238) return 231;
    return 232 + Math.round((r - 8) / 247 * 23);
  }
  return 16 + 36 * lvl(r) + 6 * lvl(g) + lvl(b);
}
const fgCode = TRUECOLOR ? (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : (c) => `\x1b[38;5;${to256(c)}m`;
const bgCode = TRUECOLOR ? (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : (c) => `\x1b[48;5;${to256(c)}m`;

class Canvas {
  constructor(W, H, bg) {
    this.W = W; this.H = H;
    const n = W * H;
    this.ch = new Array(n).fill(' ');
    this.f = new Array(n).fill(bg);
    this.b = new Array(n).fill(bg);
    this.B = new Uint8Array(n);
  }
  idx(x, y) { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.W || y >= this.H ? -1 : y * this.W + x; }
  bg(x, y, b) { const i = this.idx(x, y); if (i >= 0) this.b[i] = b; }
  getBg(x, y) { const i = this.idx(x, y); return i >= 0 ? this.b[i] : [0, 0, 0]; }
  set(x, y, ch, f, b, bold = false) {
    const i = this.idx(x, y); if (i < 0) return;
    this.ch[i] = ch; if (f) this.f[i] = f; if (b) this.b[i] = b; this.B[i] = bold ? 1 : 0;
  }
  // segments: [[text, fg, bold?, bg?], ...]; alpha fades against what's underneath
  segs(x, y, segs, o = {}) {
    const a = o.alpha ?? 1, l = o.clipL ?? 0, r = o.clipR ?? this.W, max = o.max ?? Infinity;
    let cx = x, n = 0;
    for (const [text, fg, bold, bgc] of segs) {
      for (const ch of text) {
        if (n++ >= max) return cx;
        if (cx >= l && cx < r) {
          const i = this.idx(cx, y);
          if (i >= 0) {
            const under = this.b[i];
            const b2 = bgc ? mix(under, bgc, a) : null;
            if (ch === ' ' && !bgc) { cx++; continue; }
            this.ch[i] = ch; this.f[i] = mix(b2 || under, fg, a); if (b2) this.b[i] = b2; this.B[i] = bold ? 1 : 0;
          }
        }
        cx++;
      }
    }
    return cx;
  }
  lines() {
    const out = [];
    for (let y = 0; y < this.H; y++) {
      let s = '', pf = null, pb = null, pB = 0;
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x, f = this.f[i], b = this.b[i], B = this.B[i];
        if (B !== pB) { s += B ? '\x1b[1m' : '\x1b[22m'; pB = B; }
        if (!pb || b[0] !== pb[0] || b[1] !== pb[1] || b[2] !== pb[2]) { s += bgCode(b); pb = b; }
        if (this.ch[i] !== ' ' && (!pf || f[0] !== pf[0] || f[1] !== pf[1] || f[2] !== pf[2])) { s += fgCode(f); pf = f; }
        s += this.ch[i];
      }
      out.push(s + '\x1b[0m');
    }
    return out;
  }
}

module.exports = { TRUECOLOR, Canvas, hex, mix, ease, clamp01 };
