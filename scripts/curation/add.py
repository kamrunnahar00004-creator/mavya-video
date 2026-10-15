import json, os, sys, urllib.parse, urllib.request

ROOT = "/home/farhan/mavya-video"
PICKS = f"{ROOT}/.data/curation/picks.json"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
# "username" or "username:minviews" (founder exceptions below the 100K rule)
u, _, min_arg = sys.argv[1].strip().lstrip("@").partition(":")
MIN = int(min_arg or os.environ.get("MIN_VIEWS", 50_000))
MEDIA = "permalink,view_count,like_count,comments_count,timestamp,caption,thumbnail_url,media_url"
media, after = [], None
while True:
    page = f".after({after})" if after else ""
    fields = f"business_discovery.username({u}){{followers_count,media.limit(100){page}{{{MEDIA}}}}}"
    url = f"https://graph.facebook.com/v26.0/{env['IG_USER_ID']}?" + urllib.parse.urlencode({"fields": fields, "access_token": env["META_ACCESS_TOKEN"]})
    try:
        bd = json.load(urllib.request.urlopen(url, timeout=30))["business_discovery"]
    except urllib.error.HTTPError as e:
        print("ERROR", json.load(e).get("error", {}).get("message")); sys.exit()
    m = bd.get("media", {})
    media += m.get("data", [])
    nxt = m.get("paging", {}).get("cursors", {}).get("after")
    if not nxt or nxt == after or not m.get("data") or len(media) >= 500:
        break
    after = nxt

d = json.load(open(PICKS))
if u in d["accounts"]:
    print("DUPLICATE: already in list"); sys.exit()
followers = bd.get("followers_count") or 1
print(f"{u}: scanned {len(media)} posts, {followers:,} followers")
ranked = sorted(media, key=lambda x: x.get("view_count") or 0, reverse=True)
for i, x in enumerate(ranked[:4]):
    v, l, c = x.get("view_count") or 0, x.get("like_count") or 0, x.get("comments_count") or 0
    print(f"#{i+1} {v:,} views ({v / followers:.0f}x), {l:,} likes ({100 * l / max(v, 1):.2f}%), {c:,} comments, {x['timestamp'][:10]}")
    print("  ", x["permalink"], "|", (x.get("caption") or "").replace("\n", " ")[:110])
code = lambda link: link.rstrip("/").split("/")[-1]
by_code = {code(x["permalink"]): x for x in media}
for mp in d.get("manual_picks", []):
    x = by_code.get(code(mp["url"]))
    if x:
        mp.update(account=u, url=x["permalink"], views=x.get("view_count"), likes=x.get("like_count"),
                  comments=x.get("comments_count"), caption=(x.get("caption") or "")[:200])
        print(f"MANUAL PICK matched: {x.get('view_count') or 0:,} views, {x.get('like_count') or 0:,} likes {x['permalink']}")
d["accounts"].append(u)
d.setdefault("expanded", []).append(u)  # this scan already takes every qualifying video
def cover(x):
    """Save the cover locally (Instagram image links expire). Returns /api/media path or None."""
    if not x.get("thumbnail_url"):
        return None
    import uuid
    name = f"{uuid.uuid4()}.jpg"
    try:
        with urllib.request.urlopen(x["thumbnail_url"], timeout=30) as r:
            open(f"{ROOT}/.data/media/{name}", "wb").write(r.read())
        return f"/api/media/{name}"
    except Exception:
        return None

def source(x):
    """Save the Reel file now (the link expires). Instagram omits media_url when the music is copyrighted.
    Founder rule: no downloadable file = can't be recreated = not picked."""
    if not x.get("media_url"):
        return False
    os.makedirs(f"{ROOT}/.data/sources", exist_ok=True)
    try:
        with urllib.request.urlopen(x["media_url"], timeout=60) as r:
            data = r.read(40_000_000)
    except Exception:
        return False
    if data[4:8] != b"ftyp":
        return False
    open(f"{ROOT}/.data/sources/{code(x['permalink'])}.mp4", "wb").write(data)
    return True

chosen = []
for x in ranked:  # every video over the minimum with a downloadable file (cap 30 per account)
    if len(chosen) == 30 or (x.get("view_count") or 0) < MIN:
        break
    if source(x):
        chosen.append(x)
    else:
        print("   skip (no downloadable file):", x["permalink"])
d["picks"] += [{"account": u, "url": x["permalink"], "views": x.get("view_count"), "likes": x.get("like_count"),
                "comments": x.get("comments_count"), "caption": (x.get("caption") or "")[:200], "thumb": cover(x),
                "postedAt": x.get("timestamp"), "followers": bd.get("followers_count"), "hasFile": True}
               for x in chosen]
json.dump(d, open(PICKS, "w"), indent=2)
print(f"TOTAL {len(d['accounts'])} accounts, {len(d['picks'])} picks")
