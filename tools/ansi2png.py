#!/usr/bin/env python3
"""Render a truecolor ANSI frame (from `--snapshot`) to a crisp PNG. Usage: ansi2png.py in.ans out.png"""
import re, sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SIZE = 15
DEF_FG, DEF_BG = (230, 225, 255), (13, 10, 26)

def parse(text):
    rows = []
    for line in text.rstrip("\n").split("\n"):
        fg, bg, b = DEF_FG, DEF_BG, False
        cells, i = [], 0
        while i < len(line):
            m = re.match(r"\x1b\[([0-9;?]*)([a-zA-Z])", line[i:])
            if m:
                i += m.end()
                if m.group(2) != "m":
                    continue
                p = [int(x) if x else 0 for x in m.group(1).split(";")]
                j = 0
                while j < len(p):
                    c = p[j]
                    if c == 0: fg, bg, b = DEF_FG, DEF_BG, False
                    elif c == 1: b = True
                    elif c == 22: b = False
                    elif c == 39: fg = DEF_FG
                    elif c == 49: bg = DEF_BG
                    elif c in (38, 48) and j + 4 < len(p) and p[j + 1] == 2:
                        col = tuple(p[j + 2:j + 5])
                        if c == 38: fg = col
                        else: bg = col
                        j += 4
                    j += 1
                continue
            cells.append((line[i], fg, bg, b))
            i += 1
        rows.append(cells)
    return rows

def main(src, dst):
    text = open(src, encoding="utf-8").read()
    if "\f" in text:  # multi-frame file -> dst is a directory
        import os
        os.makedirs(dst, exist_ok=True)
        for i, fr in enumerate(text.split("\f")):
            draw(parse(fr)).save(os.path.join(dst, f"{i:05d}.png"))
        return
    draw(parse(text)).save(dst)

def draw(rows):
    f, fb = ImageFont.truetype(FONT, SIZE), ImageFont.truetype(FONTB, SIZE)
    cw, ch = round(f.getlength("M")), SIZE + 4
    W = max(len(r) for r in rows)
    img = Image.new("RGB", (W * cw, len(rows) * ch), DEF_BG)
    d = ImageDraw.Draw(img)
    for y, r in enumerate(rows):
        for x, (c, fg, bg, b) in enumerate(r):
            x0, y0 = x * cw, y * ch
            d.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=bg)
            if c == " ": continue
            if c == "█": d.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=fg)
            elif c == "▀": d.rectangle([x0, y0, x0 + cw - 1, y0 + ch // 2 - 1], fill=fg)
            elif c == "▄": d.rectangle([x0, y0 + ch // 2, x0 + cw - 1, y0 + ch - 1], fill=fg)
            elif c in "▏▎▍▌▋▊▉":
                k = "▏▎▍▌▋▊▉".index(c) + 1
                d.rectangle([x0, y0, x0 + max(1, round(cw * k / 8)) - 1, y0 + ch - 1], fill=fg)
            elif c in "▓▒":
                k = 0.75 if c == "▓" else 0.5
                d.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=tuple(int(b2 + (a - b2) * k) for a, b2 in zip(fg, bg)))
            elif c == "░":
                mixc = tuple((a + 2 * bb) // 3 for a, bb in zip(fg, bg))
                d.rectangle([x0 + 1, y0 + 3, x0 + cw - 2, y0 + ch - 4], fill=mixc)
            else: d.text((x0, y0 + 1), c, font=fb if b else f, fill=fg)
    return img

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
