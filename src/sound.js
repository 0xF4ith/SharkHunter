// Plays assets/bite.wav with whatever player the OS has. Falls back to the terminal bell.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const os = require('os');
const SRC = path.join(__dirname, '..', 'assets', 'bite.wav');
let FILE = SRC;
// inside a packaged app the wav lives in a virtual filesystem: copy it out so OS players can read it
if (process.pkg) {
  try { FILE = path.join(os.tmpdir(), 'sharkhunter-bite.wav'); fs.writeFileSync(FILE, fs.readFileSync(SRC)); } catch { FILE = SRC; }
}
let player = null;

function has(cmd) {
  try { return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

function detect() {
  if (!fs.existsSync(FILE)) return null;
  if (process.platform === 'darwin') return ['afplay', [FILE]];
  if (process.platform === 'win32') return ['powershell', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${FILE}').PlaySync()`]];
  for (const [c, a] of [['paplay', [FILE]], ['aplay', ['-q', FILE]], ['pw-play', [FILE]], ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', FILE]]]) if (has(c)) return [c, a];
  return null;
}

let last = 0;
function bite({ muted = false } = {}) {
  if (muted) return;
  const now = Date.now();
  if (now - last < 300) return;
  last = now;
  if (player === null) player = detect() || false;
  if (!player) { process.stdout.write('\x07'); return; }
  try { spawn(player[0], player[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

module.exports = { bite, FILE };
