# Turns the collected Reddit candidates into scoreable cases, with the bot's
# reading as the provisional truth (see reddit-finalize.py for the rule).
#
#   python3 tools/benchmark/reddit-cases.py
import json, hashlib, datetime

DIR = ".tmp/benchmark/reddit"
cases = []
for x in json.load(open(f"{DIR}/candidates.json")):
    data = open(f"{DIR}/{x['file']}", "rb").read()
    cases.append({"file": x["file"], "source": "reddit", "placement": x["placement"], "orientation": None, "phase": None,
                  "config": x["sub"], "seenInTraining": None, "recipe": x["permalink"], "sha256": hashlib.sha256(data).hexdigest()})
json.dump({"built": datetime.date.today().isoformat(), "cases": cases}, open(f"{DIR}/cases-provisional.json", "w"), indent=1)
print(len(cases), "cases")
