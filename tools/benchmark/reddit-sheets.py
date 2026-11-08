# Contact sheets for checking Reddit candidates by eye, BEFORE fenshot runs:
# each row is the Reddit image next to the bot's position drawn from White's
# side and from Black's side. A case is accepted only if one drawing matches
# the image square for square.
#
#   python3 tools/benchmark/reddit-sheets.py [--sample 80]
#
# Sample: candidates sorted by post id, every k-th (deterministic).
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

OUT = ".tmp/benchmark/reddit"
n = int(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else 80
cands = json.load(open(f"{OUT}/sample.json")) if "--use-sample" in sys.argv else sorted(json.load(open(f"{OUT}/candidates.json")), key=lambda c: c["postId"])
step = max(1, len(cands) // n)
sample = cands[::step][:n]
if "--use-sample" not in sys.argv:
    json.dump(sample, open(f"{OUT}/sample.json", "w"), indent=1)

GLYPH = {"K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": "♙", "k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟"}
font = ImageFont.truetype("/System/Library/Fonts/Apple Symbols.ttf", 40)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
title = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)

def board(placement, black, size=400):
    rows = [list("".join("." * int(ch) if ch.isdigit() else ch for ch in r)) for r in placement.split("/")]
    img = Image.new("RGB", (size, size), "white")
    d = ImageDraw.Draw(img)
    sq = size // 8
    for r in range(8):
        for f in range(8):
            rr, ff = (7 - r, 7 - f) if black else (r, f)
            x, y = f * sq, r * sq
            d.rectangle([x, y, x + sq, y + sq], fill=(181, 136, 99) if (r + f) % 2 else (240, 217, 181))
            p = rows[rr][ff]
            if p != ".":
                d.text((x + sq / 2, y + sq / 2), GLYPH[p], font=font, anchor="mm", fill="black")
            if f == 0:
                d.text((x + 2, y + 2), str(8 - rr), font=small, fill=(60, 60, 60))
            if r == 7:
                d.text((x + sq - 10, y + sq - 16), "abcdefgh"[ff], font=small, fill=(60, 60, 60))
    return img

def fit(path, h=400, w=400):
    im = Image.open(path).convert("RGB")
    im.thumbnail((w, h))
    return im

rows_per_sheet = 3
for s in range(0, len(sample), rows_per_sheet):
    sheet = Image.new("RGB", (1240, rows_per_sheet * 440), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, c in enumerate(sample[s:s + rows_per_sheet]):
        y = i * 440
        crop = f"{OUT}/crop-{os.path.splitext(c['file'])[0]}.png"
        d.text((10, y + 6), f"#{s + i}  {c['postId']}", font=title, fill="yellow")
        sheet.paste(fit(crop if os.path.exists(crop) else f"{OUT}/{c['file']}"), (0, y + 36))
        sheet.paste(board(c["placement"], False), (420, y + 36))
        sheet.paste(board(c["placement"], True), (830, y + 36))
    sheet.save(f"{OUT}/sheet-{s // rows_per_sheet:02d}.png")
print(len(sample), "sampled,", -(-len(sample) // rows_per_sheet), "sheets")
