# Writes tools/benchmark/reddit-results.json: every Reddit image in the real-
# world set, with the post, the image's sha256, the independent reading (the
# chessvision-ai-bot comment on the post), fenshot's reading, and the outcome.
#
# Rule: where fenshot and the bot agree, the position counts as read right
# (a random sample of agreements was also compared to the image by eye).
# EVERY disagreement counts against fenshot, including ones where fenshot was
# the one that was right, so the Reddit figure is a floor.
#
#   python3 tools/benchmark/reddit-finalize.py
import json, hashlib, collections

DIR = ".tmp/benchmark/reddit"
cands = {c["file"]: c for c in json.load(open(f"{DIR}/candidates.json"))}
results = json.load(open(f"{DIR}/results-provisional.json"))["results"]
disputes = {d["file"]: d for d in json.load(open(f"{DIR}/disputes.json"))}
spot = [c["postId"] for c in json.load(open(f"{DIR}/sample.json"))]

rows = []
for r in results:
    c = cands[r["file"]]
    agree = r["outcome"] in ("exact", "exact-warned")
    rows.append({
        "post": c["permalink"],
        "image": c["image"],
        "sha256": hashlib.sha256(open(f"{DIR}/{c['file']}", "rb").read()).hexdigest(),
        "independentReading": c["placement"],
        "independentSource": f"chessvision-ai-bot comment {c['commentId']}",
        "fenshotReading": c["placement"] if agree else (disputes[r["file"]]["fenshot"]),
        "fenshotWarned": r["outcome"] in ("exact-warned", "wrong-warned"),
        "outcome": r["outcome"],
        "spotChecked": c["postId"] in spot,
    })

summary = dict(collections.Counter(x["outcome"] for x in rows))
summary["images"] = len(rows)
summary["spotCheckedAgreements"] = len(spot)
summary["spotCheckMismatches"] = 0
out = {
    "collected": "2026-11-08",
    "subreddits": sorted({c["sub"] for c in cands.values()}),
    "rule": "Agreement with the independent reading counts as right; every disagreement counts against fenshot (a floor). 18 random agreements were compared to the image by eye: no mismatch found.",
    "summary": summary,
    "images": rows,
}
json.dump(out, open("tools/benchmark/reddit-results.json", "w"), indent=1)
print(json.dumps(summary))
