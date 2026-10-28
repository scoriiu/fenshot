"""Compose the 0.5.0 store screenshots (1280x800, 24-bit, no alpha): one
caption bar style for all, highlights drawn on the image so no page can
clip them. Run from the fenshot repo root: python3 store-assets/0.5.0/compose.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DIR = "store-assets/0.5.0"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
S = 2  # work at 2x, downscale at the end
BG = (12, 17, 23)


def caption(d, title, sub):
    d.rectangle([0, 0, 1280 * S, 80 * S - 1], fill=BG)
    d.line([(0, 80 * S - 1), (1280 * S, 80 * S - 1)], fill=(51, 65, 85), width=S)
    d.text((32 * S, 16 * S), "fenshot", font=ImageFont.truetype(BOLD, 22 * S), fill=(245, 158, 11))
    d.text((150 * S, 14 * S), title, font=ImageFont.truetype(BOLD, 26 * S), fill=(241, 245, 249))
    d.text((150 * S, 48 * S), sub, font=ImageFont.truetype(REG, 17 * S), fill=(148, 163, 184))


def hero():
    page = Image.open(f"{DIR}/raw/hero-page.png").convert("RGB").resize((1280 * S, 720 * S), Image.LANCZOS)
    popup = Image.open(f"{DIR}/raw/hero-popup.png").convert("RGB")
    img = Image.new("RGB", (1280 * S, 800 * S), BG)
    img.paste(page, (0, 80 * S))
    # The popup hangs from the top-right, where Chrome opens it.
    px, py = 1280 * S - popup.width - 28 * S, 80 * S + 14 * S
    shadow = Image.new("L", (popup.width + 80 * S, popup.height + 80 * S), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([40 * S, 46 * S, popup.width + 40 * S, popup.height + 46 * S], radius=14 * S, fill=170)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18 * S))
    img.paste((0, 0, 0), (px - 40 * S, py - 40 * S), shadow)
    mask = Image.new("L", popup.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, popup.width - 1, popup.height - 1], radius=12 * S, fill=255)
    img.paste(popup, (px, py), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([px, py, px + popup.width - 1, py + popup.height - 1], radius=12 * S, outline=(51, 65, 85), width=S)
    caption(d, "Any chessboard on your screen, one click to analysis", "Articles, books, videos, screenshots. Read on your device, nothing is uploaded.")
    save(img, "1-hero")



def highlight(d, box):
    d.rounded_rectangle(box, radius=12 * S, outline=(245, 158, 11), width=3 * S)


def chesscom():
    import json
    raw = Image.open(f"{DIR}/raw/raw-chesscom.png").convert("RGB")  # 2560x1440
    img = Image.new("RGB", (1280 * S, 800 * S), BG)
    img.paste(raw, (0, 80 * S))
    d = ImageDraw.Draw(img)
    b = json.load(open(f"{DIR}/raw/box-chesscom.json"))
    pad = 6
    highlight(d, [(b["x"] - pad) * S, (b["y"] + 80 - pad) * S, (b["x"] + b["width"] + pad) * S, (b["y"] + 80 + b["height"] + pad) * S])
    caption(d, "Every finished chess.com game, one click to Kibitzo", "Turn on the Analyze button once. It sits under Game Review.")
    save(img, "2-chesscom")


def lichess():
    # Founder's logged-in screenshot (2986x1472); the post-game buttons have
    # no fill of their own, so the button is the column's full-width row.
    src = Image.open(f"{DIR}/raw/lichess-loggedin.png").convert("RGB")
    W, H = src.size
    cw = round(H * 16 / 9); x0 = W - cw
    k = (1280 * S) / cw
    img = Image.new("RGB", (1280 * S, 800 * S), BG)
    img.paste(src.crop((x0, 0, W, H)).resize((1280 * S, round(H * k)), Image.LANCZOS), (0, 80 * S))
    d = ImageDraw.Draw(img)
    ty, th, pitch = 1089, 30, 96
    row = (2068, ty + th / 2 - pitch / 2 + 4, 2872, ty + th / 2 + pitch / 2 - 4)
    highlight(d, [(row[0] - x0) * k, row[1] * k + 80 * S, (row[2] - x0) * k, row[3] * k + 80 * S])
    caption(d, "The same button on Lichess", "Finished games only. Off until you switch it on.")
    save(img, "3-lichess")


def result():
    page = Image.open(f"{DIR}/raw/result-page.png").convert("RGB").resize((1280 * S, 720 * S), Image.LANCZOS)
    img = Image.new("RGB", (1280 * S, 800 * S), BG)
    img.paste(page, (0, 80 * S))
    d = ImageDraw.Draw(img)
    caption(d, "One click later: the game on a free analysis board", "Engine lines, every move, and a coach's review one tap away, on kibitzo.com.")
    save(img, "4-result")


def save(img, name):
    out = f"{DIR}/fenshot-0.5.0-{name}-1280x800.png"
    img.resize((1280, 800), Image.LANCZOS).save(out)
    print(out)


hero()
chesscom()
lichess()
result()
