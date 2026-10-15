"""Drop hooks from the library by Instagram link. Usage: drop.py "<reason>" <url> [<url> ...]"""
import json, os, sys

ROOT = "/home/farhan/mavya-video"
code = lambda link: link.rstrip("/").split("/")[-1]
reason, codes = sys.argv[1], {code(u) for u in sys.argv[2:]}

db_path = f"{ROOT}/.data/db.json"
db = json.load(open(db_path))
gone = [r for r in db["references"] if r.get("sourceUrl") and code(r["sourceUrl"]) in codes]
db["references"] = [r for r in db["references"] if r not in gone]
for r in gone:
    k = code(r["sourceUrl"])
    files = [f"{ROOT}/.data/sources/{k}.mp4", f"{ROOT}/.data/hooks/{k}.mp4"] + [f"{ROOT}/.data/hooks/{k}.demo{i}.jpg" for i in (1, 2, 3)]
    if r.get("thumbUrl", "").startswith("/api/media/"):
        files.append(f"{ROOT}/.data/media/{r['thumbUrl'].split('/')[-1]}")
    for f in files:  # dropped = nothing kept
        try:
            os.remove(f)
        except FileNotFoundError:
            pass
tmp = db_path + ".tmp"
json.dump(db, open(tmp, "w"), indent=2)
os.replace(tmp, db_path)

picks_path = f"{ROOT}/.data/curation/picks.json"
p = json.load(open(picks_path))
for x in [x for x in p["picks"] if code(x["url"]) in codes]:
    p["picks"].remove(x)
    p["dropped"].append({"account": x["account"], "url": x["url"], "reason": reason})
json.dump(p, open(picks_path, "w"), indent=2)

for r in gone:
    print("dropped", r.get("author"), r.get("views"), r["title"][:60])
print("library:", sum(1 for r in db["references"] if r.get("owner", "curated") == "curated"), "hooks")
