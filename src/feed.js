// DEMO feed: simulated pump.fun-style tokens moving through the 3 Axiom lanes.
// Swap this for a real adapter (see README) — same token shape, same events.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['PEPE', 'WIF', 'BONK', 'SHARK', 'GOAT', 'MOODENG', 'CHAD', 'FROG', 'NEKO', 'DOGE',
  'TRUMP', 'CAT', 'BRETT', 'SIGMA', 'GIGA', 'POPCAT', 'MEW', 'JEET', 'RIZZ', 'WAGMI', 'BASED',
  'HAMSTER', 'PNUT', 'FWOG', 'MOON', 'ZEUS', 'GROK', 'AIXBT', 'CLAUDE', 'BLOCK', 'CREEPER',
  'STEVE', 'DIAMOND', 'NETHER', 'FISH', 'BAGS', 'WHALE', 'KRILL', 'TUNA', 'FIN'];
const SUFFIX = ['', '', '', 'AI', 'INU', '2', 'X', 'COIN', 'ON', 'SOL', 'WIF'];
const PROTOCOLS = ['Pump', 'Pump', 'Pump', 'Pump', 'Bonk', 'Bonk', 'Bordrless', 'Rise Pro', 'Liquid',
  'Vertigo', 'MetaDAO', 'Pangea', 'Moonshot', 'Believe', 'Bags', 'Boop'];

class DemoFeed {
  constructor(seed = Date.now()) {
    this.r = mulberry32(seed);
    this.t = 0;
    this.id = 0;
    this.tokens = [];
    this.events = [];
    for (let i = 0; i < 12; i++) this.spawn('newPairs');
    for (let i = 0; i < 10; i++) this.spawn('finalStretch');
    for (let i = 0; i < 10; i++) this.spawn('migrated');
  }

  rand(a, b) { return a + (b - a) * this.r(); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }

  uniqueTicker() {
    const taken = new Set(this.tokens.map((t) => t.ticker));
    for (let i = 0; i < 20; i++) {
      const tk = this.pick(WORDS) + this.pick(SUFFIX);
      if (!taken.has(tk)) return tk;
    }
    return this.pick(WORDS) + Math.floor(this.r() * 99);
  }

  spawn(stage) {
    const r = () => this.r();
    const shady = r() < 0.3; // shady launches have worse distribution
    const t = {
      id: ++this.id,
      ticker: this.uniqueTicker(),
      protocol: this.pick(PROTOCOLS),
      stage,
      ageMin: stage === 'newPairs' ? this.rand(0, 1.5) : stage === 'finalStretch' ? this.rand(4, 30) : this.rand(8, 70),
      bondingCurve: stage === 'newPairs' ? this.rand(2, 40) : stage === 'finalStretch' ? this.rand(70, 95) : 100,
      marketCap: stage === 'newPairs' ? this.rand(3500, 12000) : stage === 'finalStretch' ? this.rand(12000, 60000) : this.rand(25000, 450000),
      devHolding: shady ? this.rand(8, 30) : this.rand(0, 9),
      top10Holders: shady ? this.rand(40, 70) : this.rand(18, 45),
      bundle: shady ? this.rand(18, 45) : this.rand(0, 20),
      snipers: shady ? this.rand(15, 35) : this.rand(2, 18),
      insiders: this.rand(0, 15),
      freshWalletsHoldPercent: shady ? this.rand(15, 40) : this.rand(2, 18),
      holders: 0, botUsers: 0, volume: 0, fees: 0, txns: 0, liquidity: 0,
      mintable: r() < (shady ? 0.25 : 0.03),
      freezable: r() < (shady ? 0.2 : 0.02),
      lpBurnt: r() < 0.6,
      devSelling: false, clusterMove: false, sellPressure: false, lpPulled: false, dead: false, deadAt: null,
      rugAt: null, rugDrop: 0,
      born: this.t,
    };
    if (shady ? r() < 0.75 : r() < 0.28) t.rugAt = this.t + Math.floor(this.rand(18, 80));
    const scale = t.marketCap / 10000;
    t.volume = t.marketCap * this.rand(0.8, 3);
    t.holders = Math.floor(20 + scale * this.rand(15, 40));
    t.botUsers = Math.floor(t.holders * this.rand(0.1, 0.6));
    t.txns = Math.floor(t.volume / this.rand(40, 120));
    t.fees = t.volume * 0.0001 * this.rand(0.5, 1.5);
    if (stage === 'migrated') t.liquidity = t.marketCap * this.rand(0.12, 0.3);
    this.tokens.push(t);
    return t;
  }

  emit(type, t, extra = {}) { this.events.push({ at: this.t, type, token: t, ...extra }); }

  tick() {
    this.t++;
    this.events = [];
    for (const t of this.tokens) {
      if (t.dead) continue;
      t.ageMin += 10 / 60; // 1 tick ≈ 10s of chain time (sped up)
      const until = t.rugAt != null ? t.rugAt - this.t : Infinity;

      // price action: drift up for healthy coins, bleed before rugs
      let drift = this.rand(-0.065, 0.072);
      if (until < 10) drift -= 0.015;
      t.marketCap = Math.max(800, t.marketCap * (1 + drift));
      const v = t.marketCap * this.rand(0.02, 0.12);
      t.volume += v;
      t.txns += Math.floor(v / this.rand(40, 120));
      t.fees += v * 0.0001;
      t.holders += Math.floor(this.rand(0, 4 + t.marketCap / 20000));
      t.botUsers = Math.floor(t.holders * 0.35);
      if (t.stage === 'migrated') t.liquidity = t.marketCap * 0.2;

      // pre-rug signals start showing before the rug
      if (until <= 22) t.freshWalletsHoldPercent = Math.min(60, t.freshWalletsHoldPercent + this.rand(0.8, 2.2));
      if (until <= 22) t.snipers = Math.min(50, t.snipers + this.rand(0, 1.2));
      if (until <= 14 && !t.clusterMove) {
        t.clusterMove = true;
        t.top10Holders = Math.min(90, t.top10Holders + this.rand(6, 14));
        this.emit('cluster', t);
      }
      if (until <= 9 && !t.sellPressure) {
        t.sellPressure = true;
        this.emit('sell_pressure', t);
      }
      if (until <= 6 && !t.devSelling) {
        t.devSelling = true;
        this.emit('dev_sell', t);
      }
      if (t.devSelling) t.devHolding = Math.max(0, t.devHolding - this.rand(0.5, 2));

      if (until <= 0) {
        t.dead = true; t.deadAt = this.t;
        t.rugDrop = this.rand(82, 98);
        t.marketCap *= 1 - t.rugDrop / 100;
        if (t.stage === 'migrated') { t.lpPulled = true; t.liquidity = 0; }
        this.emit('rug', t);
        continue;
      }

      // lane progression
      if (t.stage !== 'migrated') {
        t.bondingCurve = Math.min(100, t.bondingCurve + this.rand(0, t.stage === 'newPairs' ? 4 : 2));
        if (t.stage === 'newPairs' && t.bondingCurve >= 70) t.stage = 'finalStretch';
        if (t.bondingCurve >= 100) {
          t.stage = 'migrated';
          t.liquidity = t.marketCap * 0.2;
          this.emit('migrate', t);
        }
      }
      if (t.ageMin > 100) t.dead = true;
    }
    // clean up and keep the ocean full
    this.tokens = this.tokens.filter((t) => !t.dead || this.t - (t.deadAt ?? this.t) < 12);
    const live = (s) => this.tokens.filter((t) => !t.dead && t.stage === s).length;
    if (live('newPairs') < 14 || this.r() < 0.6) this.spawn('newPairs');
    if (live('finalStretch') < 12 || this.r() < 0.25) this.spawn('finalStretch');
    if (live('migrated') < 14 || this.r() < 0.25) this.spawn('migrated');
    return this.events;
  }
}

module.exports = { DemoFeed };
