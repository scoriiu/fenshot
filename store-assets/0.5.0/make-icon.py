"""Store icon (0.5.0): the favicon.svg artwork (apps/web/public), redrawn at
8x and downscaled. Chrome Web Store guideline: 128x128 with the artwork in
the central 96x96 and 16px of transparent padding; a faint light rim keeps
the dark tile visible on the store's dark theme.
Run from the fenshot repo root: python3 store-assets/0.5.0/make-icon.py"""
from PIL import Image, ImageDraw

K = 8                      # supersampling
ART, PAD = 96, 16          # artwork size and padding at 128
u = ART * K / 64           # favicon.svg units (viewBox 0 0 64 64) -> pixels
img = Image.new("RGBA", (128 * K, 128 * K), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
o = PAD * K


def rect(x, y, w, h, r, fill, outline=None, width=0):
    d.rounded_rectangle([o + x * u, o + y * u, o + (x + w) * u - 1, o + (y + h) * u - 1], radius=r * u, fill=fill, outline=outline, width=width)


rect(0, 0, 64, 64, 14, (12, 17, 23, 255), outline=(255, 255, 255, 34), width=int(1.2 * K))
rect(14, 14, 18, 18, 3, (245, 158, 11, 255))
rect(32, 32, 18, 18, 3, (245, 158, 11, 255))
rect(32, 14, 18, 18, 3, (40, 52, 74, 255))
rect(14, 32, 18, 18, 3, (40, 52, 74, 255))
out = "store-assets/0.5.0/1-store-icon-128x128.png"
img.resize((128, 128), Image.LANCZOS).save(out)
icon = Image.open(out)
print(out, icon.size, icon.mode, "artwork bbox", icon.split()[3].point(lambda v: 255 if v > 10 else 0).getbbox())
# Preview on the store's light and dark backgrounds.
prev = Image.new("RGB", (300, 150), (255, 255, 255))
prev.paste((32, 33, 36), (150, 0, 300, 150))
prev.paste(icon, (11, 11), icon); prev.paste(icon, (161, 11), icon)
prev.save("store-assets/0.5.0/raw/icon-preview.png")
