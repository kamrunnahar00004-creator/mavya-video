"""Import curated Instagram picks into the hook library (.data/db.json). Idempotent by sourceUrl."""
import json, os, re, uuid
from datetime import datetime, timezone

ROOT = "/home/farhan/mavya-video"
picks = json.load(open(f"{ROOT}/.data/curation/picks.json"))
db_path = f"{ROOT}/.data/db.json"
db = json.load(open(db_path)) if os.path.exists(db_path) else {"references": [], "runs": [], "assets": []}

def hook_line(caption, fallback):
    text = re.split(r"\s#", " " + (caption or ""))[0].strip()
    text = re.sub(r"""(?i)[\s.!]*comment\s+["“”']?[A-Za-z0-9]{2,20}["“”']?\s+(for|and|to|&)\b.*$""", "", text).strip() or text
    return (text or fallback)[:140]

def niche_of(t):
    t = t.lower()
    if re.search(r"cod|vibe|replit|creao|app|website|build", t): return "SaaS & apps"
    if re.search(r"marketing|ads?\b|spy|brand|content", t): return "Other"
    if re.search(r"side ?hustle|money|bank|etsy|pinterest|rent|bills", t): return "Finance"
    return "AI tools"

def style_of(t):
    t = t.lower()
    if "pov" in t: return "POV"
    if re.search(r"boyfriend|bridezilla|married|asked me out|sister|coworker", t): return "Story time"
    if re.search(r"can.?t believe|wish i (found|knew)|cheat code|changes everything|illegal|game changer|unfair|thank", t): return "Shocked reaction"
    if "?" in t: return "Question"
    return "Other"

existing = {r.get("sourceUrl") for r in db["references"]}
dropped = {x["url"] for x in picks.get("dropped", [])}
items = picks["picks"] + [m for m in picks.get("manual_picks", []) if m.get("views")]
added = 0
for p in items:
    # Each pick is imported once; removing it in the app later must not bring it back.
    if p.get("imported") or p["url"] in existing or p["url"] in dropped:
        p["imported"] = True
        continue
    p["imported"] = True
    cap = p.get("caption") or ""
    full = cap + " " + " ".join(re.findall(r"#\w+", cap))
    db["references"].append({
        "id": str(uuid.uuid4()),
        "title": hook_line(cap, f"@{p['account']}"),
        "platform": "instagram",
        "sourceUrl": p["url"],
        "views": p.get("views"),
        "likes": p.get("likes"),
        "comments": p.get("comments"),
        "mediaId": "",
        "mime": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "analysis": None,
        "owner": "curated",
        "pending": True,  # hidden from users until the AI fit check (or the founder) approves it
        "niche": niche_of(full),
        "hookStyle": style_of(cap),
        "author": p["account"],
        "caption": cap,
        **({"thumbUrl": p["thumb"]} if p.get("thumb") else {}),
        **({"postedAt": p["postedAt"]} if p.get("postedAt") else {}),
        **({"followers": p["followers"]} if p.get("followers") else {}),
        **({"hasFile": p["hasFile"]} if "hasFile" in p else {}),
    })
    existing.add(p["url"])
    added += 1

json.dump(picks, open(f"{ROOT}/.data/curation/picks.json", "w"), indent=2)
tmp = db_path + ".tmp"
json.dump(db, open(tmp, "w"), indent=2)
os.replace(tmp, db_path)
print("added", added, "| curated total", sum(1 for r in db["references"] if r.get("owner", "curated") == "curated"))
