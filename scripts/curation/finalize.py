"""1) Drop every AI-flagged hook (founder agreed with all 98).
2) AI matches go live (pending off).
3) Cap 10 per account by views; extras are hidden (review drop "Over 10 per account"), not deleted, so it's reversible."""
import collections, json, os, subprocess
from datetime import datetime, timezone

ROOT = "/home/farhan/mavya-video"
db_path = f"{ROOT}/.data/db.json"
db = json.load(open(db_path))
cur = lambda d: [r for r in d["references"] if r.get("owner", "curated") == "curated"]

flag_refs = [r for r in cur(db) if r.get("ai", {}).get("verdict") == "flag"]
flags = [r["sourceUrl"] for r in flag_refs]
# Founder sees what the AI removed: append to a plain report before deleting.
with open(f"{ROOT}/.data/curation/flagged.log", "a") as log:
    for r in flag_refs:
        log.write(f"{datetime.now(timezone.utc).date()} @{r.get('author')} {r.get('views') or 0:,} views | {r['ai'].get('reason', '')} | {r['sourceUrl']}\n")
for i in range(0, len(flags), 40):
    subprocess.run(["python3", "-I", f"{ROOT}/scripts/curation/drop.py", "AI flag confirmed by founder", *flags[i:i + 40]],
                   capture_output=True, check=True)
print("dropped flagged:", len(flags))

db = json.load(open(db_path))
now = datetime.now(timezone.utc).isoformat()
live = 0
for r in cur(db):
    if r.get("pending") and r.get("ai", {}).get("verdict") == "match":
        r["pending"] = False
        live += 1
print("matches now live:", live)

by_acct = collections.defaultdict(list)
for r in cur(db):
    if r.get("author") and not r.get("pending") and r.get("review", {}).get("verdict") != "drop":
        by_acct[r["author"]].append(r)
capped = 0
for acct, refs in by_acct.items():
    for r in sorted(refs, key=lambda r: -(r.get("views") or 0))[10:]:
        r["review"] = {"verdict": "drop", "reason": "Over 10 per account", "at": now}
        capped += 1
print("hidden by the 10-per-account cap:", capped)

tmp = db_path + ".tmp"
json.dump(db, open(tmp, "w"), indent=2)
os.replace(tmp, db_path)
visible = [r for r in cur(db) if not r.get("pending") and r.get("review", {}).get("verdict") != "drop"]
styles = collections.Counter((r.get("ai") or {}).get("style") or "unlabeled" for r in visible)
print(f"LIVE LIBRARY: {len(visible)} hooks from {len({r.get('author') for r in visible})} accounts | styles: {dict(styles)}")
print("still pending:", sum(1 for r in cur(db) if r.get("pending")))
