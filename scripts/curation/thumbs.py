"""Download cover images for library picks into .data/media and link them (thumbUrl) in db.json.
Instagram's image links expire, so we keep a local copy. Stops cleanly on the rate limit."""
import json, os, sys, urllib.parse, urllib.request, uuid

ROOT = "/home/farhan/mavya-video"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]

def save_db(db):
    tmp = db_path + ".tmp"
    json.dump(db, open(tmp, "w"), indent=2)
    os.replace(tmp, db_path)

db = json.load(open(db_path))
need = {}
for r in db["references"]:
    if r.get("owner") == "curated" and r.get("platform") == "instagram" and not r.get("thumbUrl") and r.get("author"):
        need.setdefault(r["author"], {})[code(r["sourceUrl"])] = r["id"]
only = sys.argv[1:]
if only:
    need = {k: v for k, v in need.items() if k in only}
print("accounts needing covers:", len(need), "| videos:", sum(len(v) for v in need.values()))

done = 0
for user, wanted in need.items():
    after, found = None, {}
    for _ in range(5):  # newest 500 posts at most
        page = f".after({after})" if after else ""
        fields = f"business_discovery.username({user}){{media.limit(100){page}{{permalink,thumbnail_url,media_url,media_type}}}}"
        url = f"https://graph.facebook.com/v26.0/{env['IG_USER_ID']}?" + urllib.parse.urlencode({"fields": fields, "access_token": env["META_ACCESS_TOKEN"]})
        try:
            m = json.load(urllib.request.urlopen(url, timeout=30))["business_discovery"].get("media", {})
        except urllib.error.HTTPError as e:
            msg = json.load(e).get("error", {}).get("message", "")
            print("ERROR", user, msg)
            if "request limit" in msg:
                print("RATE LIMITED, covers done:", done); sys.exit()
            break
        for x in m.get("data", []):
            k = code(x["permalink"])
            if k in wanted:
                found[k] = x.get("thumbnail_url") or (x.get("media_url") if x.get("media_type") == "IMAGE" else None)
        nxt = m.get("paging", {}).get("cursors", {}).get("after")
        if len(found) == len(wanted) or not nxt or nxt == after:
            break
        after = nxt
    for k, img in found.items():
        if not img:
            continue
        name = f"{uuid.uuid4()}.jpg"
        try:
            with urllib.request.urlopen(img, timeout=30) as r:
                open(f"{ROOT}/.data/media/{name}", "wb").write(r.read())
        except Exception as e:
            print("download failed", user, k, e); continue
        db = json.load(open(db_path))
        for ref in db["references"]:
            if ref["id"] == wanted[k]:
                ref["thumbUrl"] = f"/api/media/{name}"
        save_db(db)
        done += 1
    print(f"{user}: {len(found)}/{len(wanted)} covers")
print("covers done:", done)
