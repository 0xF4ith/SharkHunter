// The shark brain: watches risk, opens/exits positions, writes the log.
// Uses Claude for verdicts when ANTHROPIC_API_KEY is set, local rules otherwise.
const { score, band } = require('./risk');

const EXIT_LINES = ['not today.', 'fuck that.', 'shark\'s out.', 'dev can keep his bags.', 'nope. gone.', 'cya, rugger.'];
const RUG_LINES = ['this smells like a fucking rug.', 'blood in the water.', 'classic pre-rug setup.', 'someone\'s about to get wrecked.'];
const DODGE_LINES = ['shark fed.', 'told you.', 'dodged that shit.', 'and we weren\'t in it.'];

class Agent {
  constructor({ sellLine = 70, maxPositions = 4, size = 0.5 } = {}) {
    this.sellLine = sellLine;
    this.maxPositions = maxPositions;
    this.size = size;
    this.positions = [];
    this.log = [];
    this.lastBand = new Map();
    this.stats = { scanned: 0, flagged: 0, exits: 0, dodged: 0, filtered: 0 };
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.model = process.env.SHARKHUNTER_MODEL || 'claude-sonnet-5-5';
    this.lastCall = 0;
    this.mode = this.apiKey ? 'claude' : 'rules';
    this.n = 0;
    this.trading = true;
    this.takeProfit = 18; this.stopLoss = -7; this.trail = 6; this.trailFrom = 10;
    this.ledger = { realized: 0, trades: 0, wins: 0, losses: 0, best: 0, worst: 0 };
    this.equity = [];
    this.blocked = new Set();
    this.paper = true;
    this.balance = 1; // total balance the bot may use
    this.maxLossPct = 20; // total stop loss, % of the investment (size × max open)
  }

  say(kind, text, tick) {
    const entry = { kind, text, tick, src: 'rules' };
    this.log.push(entry);
    if (this.log.length > 60) this.log.shift();
    return entry;
  }

  pick(arr) { return arr[this.n++ % arr.length]; }

  // Ask Claude for a one-line verdict; replaces the rule-based text when it lands.
  async ask(entry, t, r) {
    if (!this.apiKey || Date.now() - this.lastCall < 8000) return;
    this.lastCall = Date.now();
    const snap = {
      ticker: t.ticker, lane: t.stage, marketCap: Math.round(t.marketCap), ageMin: +t.ageMin.toFixed(1),
      devHolding: +t.devHolding.toFixed(1), top10: +t.top10Holders.toFixed(0), bundle: +t.bundle.toFixed(0),
      snipers: +t.snipers.toFixed(0), mintable: t.mintable, freezable: t.freezable,
      devSelling: t.devSelling, linkedWalletsMoving: t.clusterMove, riskScore: r.score,
    };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model, max_tokens: 60,
          system: 'You are SharkHunter, a blunt memecoin rug detector. Reply with ONE lowercase line under 16 words: the main red flag and hold/exit. Swearing allowed. No emojis.',
          messages: [{ role: 'user', content: JSON.stringify(snap) }],
        }),
      });
      const j = await res.json();
      const txt = j?.content?.[0]?.text?.trim();
      if (txt) { entry.text = `$${t.ticker} ${txt.replace(/\s+/g, ' ')}`; entry.src = 'claude'; }
    } catch { /* stay on rules */ }
  }

  step(feed, visibleByLane, events) {
    const tick = feed.t;
    const fmtPnl = (p) => (p >= 0 ? '+' : '') + p.toFixed(1) + '%';

    // 1) watch every visible token, log band escalations
    for (const list of Object.values(visibleByLane)) {
      for (const t of list) {
        if (t.dead) continue;
        const r = score(t);
        t.risk = r;
        const b = band(r.score);
        const prev = this.lastBand.get(t.id);
        if (prev === undefined) this.stats.scanned++;
        this.lastBand.set(t.id, b);
        const rank = { SAFE: 0, WATCH: 1, DANGER: 2, RUG: 3 };
        if (prev !== undefined && rank[b] > rank[prev] && rank[b] >= 2) {
          this.stats.flagged++;
          const e = b === 'RUG'
            ? this.say('rug', `$${t.ticker} risk ${r.score} · ${r.why[0]}. ${this.pick(RUG_LINES)}`, tick)
            : this.say('warn', `$${t.ticker} risk ${r.score} · ${r.why[0]}. watching.`, tick);
          this.ask(e, t, r);
        }
      }
    }

    // 2) manage positions: small losses out fast, profits taken on small risk
    for (const p of this.positions) {
      const t = p.token;
      if (p.status !== 'HOLD') continue;
      if (!t.dead) t.risk = score(t);
      p.pnl = (t.marketCap / p.entryMc - 1) * 100;
      p.peak = Math.max(p.peak ?? 0, p.pnl);
      if (t.dead) { this.close(p, 'RUGGED', tick); this.say('loss', `$${t.ticker} rugged before the line hit. ${fmtPnl(p.pnl)}. it happens.`, tick); continue; }
      let why = null;
      if (t.risk.score >= this.sellLine) why = 'RISK';
      else if (p.pnl <= this.stopLoss) why = 'SL';
      else if (p.pnl >= this.takeProfit) why = 'TP';
      else if (p.peak >= this.trailFrom && p.pnl <= p.peak - this.trail) why = 'TRAIL';
      if (!why) continue;
      const sol = this.close(p, why, tick);
      const amt = `${sol >= 0 ? '+' : ''}${sol.toFixed(3)}◎`;
      if (why === 'RISK') {
        const e = this.say('exit', `sold $${t.ticker} @ ${fmtPnl(p.pnl)} (${amt}) · risk ${t.risk.score} > line ${this.sellLine} · ${t.risk.why[0]}. ${this.pick(EXIT_LINES)}`, tick);
        this.ask(e, t, t.risk);
      } else if (why === 'TP') this.say('tp', `took profit on $${t.ticker} ${fmtPnl(p.pnl)} (${amt}). bank it.`, tick);
      else if (why === 'TRAIL') this.say('tp', `trailing stop on $${t.ticker} ${fmtPnl(p.pnl)} (${amt}) · peaked ${fmtPnl(p.peak)}.`, tick);
      else this.say('sl', `cut $${t.ticker} ${fmtPnl(p.pnl)} (${amt}). small loss, moving on.`, tick);
    }
    // session stop loss: if total PnL hits the limit, the bot stops itself
    const lim = this.lossLimit(), tot = this.totalPnl();
    if (this.trading && tot < 0 && tot <= -lim) {
      this.say('stop', `STOP LOSS TOTAL HIT: ${tot.toFixed(3)}◎ = -${this.maxLossPct}% of the ${this.balance}◎ balance. stopping everything.`, tick);
      this.stop(tick);
    }
    this.equity.push(this.totalPnl());
    if (this.equity.length > 240) this.equity.shift();

    // 3) rug events: did we dodge one we held?
    for (const ev of events) {
      if (ev.type !== 'rug') continue;
      const p = this.positions.find((x) => x.token === ev.token && x.status !== 'HOLD' && x.status !== 'RUGGED');
      if (p) {
        this.stats.dodged++;
        const secs = (ev.at - p.exitTick) * 10;
        this.say('dodge', `$${ev.token.ticker} just rugged -${ev.token.rugDrop.toFixed(0)}%. we left ${secs}s before. ${this.pick(DODGE_LINES)}`, tick);
      } else if (['DANGER', 'RUG'].includes(this.lastBand.get(ev.token.id))) {
        this.say('rugfeed', `$${ev.token.ticker} rugged -${ev.token.rugDrop.toFixed(0)}% ${ev.token.lpPulled ? '(LP pulled)' : '(dev dumped)'}. called it.`, tick);
      }
    }

    // 4) open new positions on clean coins
    this.positions = this.positions.filter((p) => p.status === 'HOLD' || tick - (p.exitTick ?? tick) < 25);
    const holding = this.positions.filter((p) => p.status === 'HOLD').length;
    if (this.trading && holding < this.maxPositions && this.cash() >= this.size - 1e-9 && tick % 3 === 0) {
      const pool = [...(visibleByLane.finalStretch || []), ...(visibleByLane.migrated || [])]
        .filter((t) => !t.dead && t.risk && t.risk.score < 35 && !this.positions.some((p) => p.token === t) && !this.blocked.has(t.id));
      const t = pool[Math.floor(feed.r() * pool.length)];
      if (t) {
        this.positions.push({ token: t, entryMc: t.marketCap, size: this.size, pnl: 0, peak: 0, status: 'HOLD', openTick: tick });
        this.say('enter', `entered $${t.ticker} ${this.size}◎ · risk ${t.risk.score} · ${t.stage === 'migrated' ? 'migrated' : 'final stretch'}`, tick);
      }
    }
  }

  close(p, status, tick) {
    p.status = status; p.exitPnl = p.pnl; p.exitTick = tick;
    const sol = p.size * p.pnl / 100;
    p.sol = sol;
    const L = this.ledger;
    L.realized += sol; L.trades++;
    if (sol >= 0) L.wins++; else L.losses++;
    L.best = Math.max(L.best, p.pnl); L.worst = Math.min(L.worst, p.pnl);
    if (status === 'RISK' || status === 'STOP') this.stats.exits++;
    return sol;
  }

  investment() { return this.balance; }
  deployed() { return this.positions.filter((p) => p.status === 'HOLD').reduce((a, p) => a + p.size, 0); }
  cash() { return this.balance + this.ledger.realized - this.deployed(); }
  lossLimit() { return this.investment() * this.maxLossPct / 100; }

  unrealized() { return this.positions.filter((p) => p.status === 'HOLD').reduce((a, p) => a + p.size * p.pnl / 100, 0); }
  totalPnl() { return this.ledger.realized + this.unrealized(); }

  stop(tick) {
    if (!this.trading) return;
    this.trading = false;
    let n = 0;
    for (const p of this.positions) if (p.status === 'HOLD') { this.close(p, 'STOP', tick); n++; }
    this.say('stop', `TRADING STOPPED. closed ${n} position${n === 1 ? '' : 's'}. realized ${this.ledger.realized >= 0 ? '+' : ''}${this.ledger.realized.toFixed(3)}◎. shark still on watch.`, tick);
  }

  start(tick) {
    if (this.trading) return;
    this.trading = true;
    this.say('info', `trading back on. ${this.size}◎ per trade.`, tick);
  }
}

module.exports = { Agent };
