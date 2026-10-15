"""Re-download the full video for hooks that were cut before the founder said "cut later",
so the AI fit check can see the whole video (demo included). Saves to .data/sources/<code>.mp4.
Only API cost: fresh media_url links (1-5 calls per account). Stops cleanly on the rate limit."""
import json, os, sys, urllib.parse, urllib.request

ROOT = "/home/farhan/mavya-video"
SRC = f"{ROOT}/.data/sources"
os.makedirs(SRC, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
code = lambda link: link.rstrip("/").split("/")[-1]

db = json.load(open(f"{ROOT}/.data/db.json"))
need = {}
for r in db["references"]:
    k = code(r.get("sourceUrl", "") or "x")
    if r.get("owner", "curated") == "curated" and r.get("author") and r.get("hookEnd") and not os.path.exists(f"{SRC}/{k}.mp4"):
        need.setdefault(r["author"], set()).add(k)
print("accounts:", len(need), "| videos:", sum(len(v) for v in need.values()))

got = 0
for user, wanted in need.items():
    after, found = None, {}
    for _ in range(5):
        page = f".after({after})" if after else ""
        fields = f"business_discovery.username({user}){{media.limit(100){page}{{permalink,media_url}}}}"
        url = f"https://graph.facebook.com/v26.0/{env['IG_USER_ID']}?" + urllib.parse.urlencode({"fields": fields, "access_token": env["META_ACCESS_TOKEN"]})
        try:
            m = json.load(urllib.request.urlopen(url, timeout=30))["business_discovery"].get("media", {})
        except urllib.error.HTTPError as e:
            msg = json.load(e).get("error", {}).get("message", "")
            print("ERROR", user, msg)
            if "request limit" in msg:
                print(f"RATE LIMITED | re-downloaded {got} so far"); sys.exit()
            break
        for x in m.get("data", []):
            if code(x["permalink"]) in wanted and x.get("media_url"):
                found[code(x["permalink"])] = x["media_url"]
        nxt = m.get("paging", {}).get("cursors", {}).get("after")
        if len(found) == len(wanted) or not nxt or nxt == after:
            break
        after = nxt
    for k, link in found.items():
        try:
            with urllib.request.urlopen(link, timeout=60) as r:
                data = r.read(40_000_000)
            if data[4:8] == b"ftyp":
                open(f"{SRC}/{k}.mp4", "wb").write(data)
                got += 1
        except Exception as e:
            print("  download failed", k, e)
    print(f"{user}: {len(found)}/{len(wanted)} re-downloaded")
print(f"REDOWNLOAD DONE | {got} videos")
