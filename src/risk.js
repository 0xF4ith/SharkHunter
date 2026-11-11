// Rug-risk score 0..100 from on-chain style metrics. Higher = more likely to rug.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function score(t) {
  let s = 0;
  const why = [];
  const add = (pts, msg) => {
    if (pts > 0.5) { s += pts; why.push([pts, msg]); }
  };
  add(clamp((t.devHolding - 5) * 1.6, 0, 22), `dev holds ${t.devHolding.toFixed(1)}%`);
  add(clamp((t.top10Holders - 30) * 0.9, 0, 20), `top10 own ${t.top10Holders.toFixed(0)}%`);
  add(clamp((t.bundle - 10) * 0.8, 0, 18), `${t.bundle.toFixed(0)}% bundled`);
  add(clamp((t.snipers - 10) * 0.8, 0, 15), `snipers sit on ${t.snipers.toFixed(0)}%`);
  add(clamp((t.freshWalletsHoldPercent - 15) * 0.6, 0, 10), `fresh wallets ${t.freshWalletsHoldPercent.toFixed(0)}%`);
  if (t.mintable) add(15, 'mint authority still ON');
  if (t.freezable) add(15, 'freeze authority still ON');
  if (t.clusterMove) add(20, 'linked wallets moving together');
  if (t.sellPressure) add(15, 'sell pressure spiking, buyers gone');
  if (t.devSelling) add(25, 'dev wallet is selling');
  if (t.lpPulled) { s = 100; why.push([999, 'LP PULLED']); }
  why.sort((a, b) => b[0] - a[0]);
  return { score: Math.round(clamp(s, 0, 100)), why: why.map((w) => w[1]) };
}

function band(s) {
  if (s >= 80) return 'RUG';
  if (s >= 60) return 'DANGER';
  if (s >= 35) return 'WATCH';
  return 'SAFE';
}

module.exports = { score, band };
