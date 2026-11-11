#!/usr/bin/env bash
# Records an MP4 of the terminal with the bite sound mixed in:
#   tools/record.sh [seed] [seconds] [out.mp4]
set -e
cd "$(dirname "$0")/.."
SEED=${1:-13}; SECS=${2:-30}; OUT=${3:-sharkhunter.mp4}
TMP=$(mktemp -d)
node src/index.js --record "$SECS" --warm 0.01 --seed "$SEED" --fps 30 --events "$TMP/bites.json" > "$TMP/all.ans"
python3 tools/ansi2png.py "$TMP/all.ans" "$TMP/frames"
python3 - "$TMP" "$SECS" "$OUT" <<'PY'
import json, subprocess, sys
tmp, secs, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
bites = [b for b in json.load(open(f"{tmp}/bites.json")) if 0 <= b < secs]
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", f"{tmp}/frames/%05d.png",
       "-f", "lavfi", "-t", str(secs), "-i", "anullsrc=r=44100:cl=mono"]
for _ in bites:
    cmd += ["-i", "assets/bite.wav"]
parts, labels = [], ["[1:a]"]
for i, b in enumerate(bites):
    ms = int(b * 1000)
    parts.append(f"[{i + 2}:a]adelay={ms}|{ms},volume=1.0[b{i}]")
    labels.append(f"[b{i}]")
parts.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=first[aout]")
cmd += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[aout]",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", out]
subprocess.run(cmd, check=True)
print(f"saved {out} ({len(bites)} bites)")
PY
rm -rf "$TMP"
