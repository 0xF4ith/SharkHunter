#!/usr/bin/env python3
"""Synthesizes assets/bite.wav: a jaw snap, a low thump and three crunches. Run: python3 tools/make_bite_sound.py"""
import os, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)
dur = 0.65
t = np.arange(int(SR * dur)) / SR
out = np.zeros_like(t)

def env(start, attack, decay):
    e = np.zeros_like(t)
    m = t >= start
    tt = t[m] - start
    e[m] = np.minimum(tt / attack, 1.0) * np.exp(-tt / decay)
    return e

def lowpass(x, a):
    y = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc); y[i] = acc
    return y

noise = rng.standard_normal(len(t))
bright = noise - lowpass(noise, 0.25)          # high-passed: teeth snap
crunchy = lowpass(noise, 0.35)                 # mid band: crunch
grit = (rng.random(len(t)) > 0.55).astype(float)  # crackly amplitude gating

# 1) jaw snap (sharp click)
out += 0.9 * bright * env(0.0, 0.0005, 0.006)
# 2) thump: pitch dropping sine
f = 120 * np.exp(-t * 9) + 55
phase = 2 * np.pi * np.cumsum(f) / SR
out += 0.8 * np.sin(phase) * env(0.0, 0.002, 0.07)
# 3) crunches
for k, (start, amp) in enumerate([(0.012, 0.9), (0.15, 0.7), (0.29, 0.5)]):
    out += amp * crunchy * (0.4 + 0.6 * grit) * env(start, 0.003, 0.045)
    out += amp * 0.35 * bright * env(start, 0.001, 0.01)
# small second snap when the jaw closes again
out += 0.5 * bright * env(0.15, 0.0005, 0.005)

out /= np.max(np.abs(out)) * 1.05
fade = np.ones_like(t); fade[-2000:] = np.linspace(1, 0, 2000)
GAIN = 0.4  # 60% quieter than full scale
pcm = (out * fade * GAIN * 32767).astype(np.int16)

dst = os.path.join(os.path.dirname(__file__), '..', 'assets', 'bite.wav')
os.makedirs(os.path.dirname(dst), exist_ok=True)
with wave.open(dst, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', os.path.abspath(dst))
