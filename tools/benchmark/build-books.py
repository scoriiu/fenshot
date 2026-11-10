# Book diagrams for the benchmark, typeset by LaTeX with the chess fonts
# printed books use (chessboard package, skak and skaknew fonts): hatched
# dark squares, a border, labels outside the board or none.
#
#   python3 tools/benchmark/build-books.py
#
# Needs pdflatex with the packages chessboard, skak, skaknew, chessfss
# (TinyTeX: tlmgr install chessboard skak skaknew chessfss xskak lambda-lists
# pgf xifthen ifmtarg fp) and pdftoppm (poppler). Every second position of
# positions.json, six styles in rotation. Images go to .tmp/benchmark/images
# and the cases are merged into cases.json under source "book-diagram".
import hashlib, json, os, subprocess, tempfile, glob
from PIL import Image, ImageChops, ImageFilter

DIR = "tools/benchmark"
IMAGES = ".tmp/benchmark/images"
TEXBIN = (glob.glob(os.path.expanduser("~/Library/TinyTeX/bin/*/")) or [""])[0]
ENV = {**os.environ, "PATH": TEXBIN + ":" + os.environ["PATH"]}

TEXT_BEFORE = "In the diagram the last move has just been played, and the question is whether the defence holds. The king is already near the centre, which matters more than the pawn."
TEXT_AFTER = "\\textbf{Diagram %d.} The position after the move in the game. The plan is simple to state and hard to carry out: improve the worst piece first."

# name, font, labels, black side, page text, dpi, board size, scan look
STYLES = [
    ("page-skak", "skak", True, False, True, 150, "20pt", False),
    ("page-skaknew-small", "skaknew", True, False, True, 110, "20pt", False),
    ("crop-skak-nolabels", "skak", False, False, False, 150, "20pt", False),
    ("crop-skaknew-black", "skaknew", True, True, False, 150, "20pt", False),
    ("scan-skak", "skak", True, False, True, 200, "20pt", True),
    ("page-skaknew-tiny", "skaknew", True, False, True, 130, "13pt", False),
]

def tex(fen, style, n):
    _, font, labels, black, page, _, size, _ = style
    opts = [f"setfen={fen}", "showmover=false", f"boardfontfamily={font}", f"boardfontsize={size}",
            f"label={'true' if labels else 'false'}", f"inverse={'true' if black else 'false'}"]
    board = "\\begin{center}\\chessboard[%s]\\end{center}" % ",".join(opts)
    body = f"\\noindent {TEXT_BEFORE}\n\n{board}\n\n\\noindent {TEXT_AFTER % n}" if page else board
    return ("\\documentclass[11pt]{article}\n\\usepackage[paperwidth=148mm,paperheight=210mm,margin=18mm]{geometry}\n"
            "\\usepackage{chessboard}\n\\pagestyle{empty}\n\\begin{document}\n" + body + "\n\\end{document}\n")

def crop_to_ink(im, margin):
    box = ImageChops.difference(im, Image.new("RGB", im.size, "white")).getbbox()
    return im.crop((max(0, box[0] - margin), max(0, box[1] - margin), min(im.width, box[2] + margin), min(im.height, box[3] + margin)))

def scan_look(im):
    """A scanned page: off-white paper, a slight tilt, soft focus, JPEG."""
    paper = Image.new("RGB", im.size, (238, 233, 220))
    im = ImageChops.multiply(im, paper).rotate(0.8, resample=Image.BICUBIC, fillcolor=(238, 233, 220))
    return im.filter(ImageFilter.GaussianBlur(0.7)).convert("L").convert("RGB")

def render(fen, style, n, out):
    with tempfile.TemporaryDirectory() as tmp:
        open(f"{tmp}/d.tex", "w").write(tex(fen, style, n))
        subprocess.run(["pdflatex", "-interaction=batchmode", "d.tex"], cwd=tmp, env=ENV, stdout=subprocess.DEVNULL, check=True)
        subprocess.run(["pdftoppm", "-r", str(style[5]), "-png", "-singlefile", "d.pdf", "d"], cwd=tmp, check=True)
        im = Image.open(f"{tmp}/d.png").convert("RGB")
    im = crop_to_ink(im, 40 if style[4] else 14)
    if style[7]:
        im = scan_look(im)
        im.save(out, "JPEG", quality=55)
    else:
        im.save(out)

positions = json.load(open(f"{DIR}/positions.json"))["positions"][::2]
os.makedirs(IMAGES, exist_ok=True)
fresh = []
for i, p in enumerate(positions):
    style = STYLES[i % len(STYLES)]
    file = f"book-{p['id']}.{'jpg' if style[7] else 'png'}"
    render(p["fen"], style, i + 1, f"{IMAGES}/{file}")
    fresh.append({
        "file": file, "source": "book-diagram", "placement": p["fen"].split()[0],
        "orientation": "black" if style[3] else "white", "phase": p["phase"], "config": style[0],
        "seenInTraining": False,
        "recipe": f"LaTeX chessboard package, style {style[0]} (font {style[1]}, {style[5]} dpi): python3 tools/benchmark/build-books.py",
        "sha256": hashlib.sha256(open(f"{IMAGES}/{file}", "rb").read()).hexdigest(),
    })

path = f"{DIR}/cases.json"
doc = json.load(open(path))
doc["cases"] = sorted([c for c in doc["cases"] if c["source"] != "book-diagram"] + fresh, key=lambda c: c["file"])
json.dump(doc, open(path, "w"), indent=1)
open(path, "a").write("\n")
print(len(fresh), "book diagrams;", len(doc["cases"]), "cases in total")
