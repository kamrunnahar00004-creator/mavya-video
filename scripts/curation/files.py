"""One-time pass per account: download the source video for every library hook that doesn't have one yet,
and add the account's OTHER videos with 100K+ views and a downloadable file (founder rule: any 100K+ video,
not just the top 2). Files go to .data/sources/<shortcode>.mp4 (temporary; hookcut.py keeps only the hook).
Instagram omits media_url when a Reel's music is copyrighted; those hooks are dropped.
Stops cleanly on the rate limit; rerun to continue."""
import json, os, sys, urllib.parse, urllib.request, uuid

ROOT = "/home/farhan/mavya-video"
SRC = f"{ROOT}/.data/sources"
os.makedirs(SRC, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
db_path = f"{ROOT}/.data/db.json"
picks_path = f"{ROOT}/.data/curation/picks.json"
code = lambda link: link.rstrip("/").split("/")[-1]
MIN_VIEWS = 50_000


def save_db(update):
    db = json.load(open(db_path))
    update(db)
    tmp = db_path + ".tmp"
    json.dump(db, open(tmp, "w"), indent=2)
    os.replace(tmp, db_path)


def download(url, dest):
    """Whole file (Reels are a few MB). Returns True only for a real MP4."""
    with urllib.request.urlopen(url, timeout=60) as r:
        data = r.read(40_000_000)
    if data[4:8] != b"ftyp":
        return False
    open(dest, "wb").write(data)
    return True


def cover(url):
    if not url:
        return None
    name = f"{uuid.uuid4()}.jpg"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            open(f"{ROOT}/.data/media/{name}", "wb").write(r.read())
        return f"/api/media/{name}"
    except Exception:
        return None


db = json.load(open(db_path))
need = {}
for r in db["references"]:
    if r.get("owner", "curated") == "curated" and r.get("platform") == "instagram" and r.get("author") and (
            "hasFile" not in r or (r["hasFile"] and not r.get("hookEnd") and not os.path.exists(f"{SRC}/{code(r['sourceUrl'])}.mp4"))):
        need.setdefault(r["author"], {})[code(r["sourceUrl"])] = r["id"]
# Every scanned account gets one "expand" pass (all 50K+ downloadable videos), once.
SKIP = {"carmenteaches", "yukatsunami"}  # founder removed these accounts' videos as off-topic
picks0 = json.load(open(picks_path))
expanded = set(picks0.get("expanded", []))
for acct in picks0["accounts"]:
    if acct not in expanded and acct not in SKIP and acct not in picks0.get("personal_skipped", []):
        need.setdefault(acct, {})
only = sys.argv[1:]
if only:
    need = {k: v for k, v in need.items() if k in only}
print("accounts:", len(need), "| hooks:", sum(len(v) for v in need.values()))

MEDIA = "permalink,media_url,media_type,view_count,like_count,comments_count,timestamp,caption,thumbnail_url"
yes = no = extra = 0
for user, wanted in need.items():
    after, posts, followers = None, [], None
    for _ in range(5):  # newest 500 posts at most
        page = f".after({after})" if after else ""
        fields = f"business_discovery.username({user}){{followers_count,media.limit(100){page}{{{MEDIA}}}}}"
        url = f"https://graph.facebook.com/v26.0/{env['IG_USER_ID']}?" + urllib.parse.urlencode({"fields": fields, "access_token": env["META_ACCESS_TOKEN"]})
        try:
            bd = json.load(urllib.request.urlopen(url, timeout=30))["business_discovery"]
        except urllib.error.HTTPError as e:
            msg = json.load(e).get("error", {}).get("message", "")
            print("ERROR", user, msg)
            if "request limit" in msg:
                print(f"RATE LIMITED | files: {yes} yes, {no} no, {extra} extra so far"); sys.exit()
            break
        followers = bd.get("followers_count")
        m = bd.get("media", {})
        posts += m.get("data", [])
        nxt = m.get("paging", {}).get("cursors", {}).get("after")
        if not nxt or nxt == after or not m.get("data"):
            break
        after = nxt
    by_code = {code(x["permalink"]): x for x in posts}

    # 1. Hooks already in the library: get the file, or drop the hook.
    for k, ref_id in wanted.items():
        x = by_code.get(k)
        if x is None:
            print("  not in newest 500 posts:", k)
            continue
        ok = False
        if x.get("media_url") and x.get("media_type") == "VIDEO":
            try:
                ok = download(x["media_url"], f"{SRC}/{k}.mp4")
            except Exception as e:
                print("  download failed", k, e)
        yes, no = yes + ok, no + (not ok)

        def mark(db, ref_id=ref_id, ok=ok):
            for ref in db["references"]:
                if ref["id"] == ref_id:
                    ref["hasFile"] = ok
        save_db(mark)
        if not ok:
            os.system(f"python3 -I {ROOT}/scripts/curation/drop.py 'no downloadable file' https://www.instagram.com/reel/{k}/ > /dev/null")

    # 2. The account's other 100K+ videos with a downloadable file.
    picks = json.load(open(picks_path))
    known = {code(p["url"]) for p in picks["picks"] + picks["dropped"]} | set(wanted)
    added = []
    for x in sorted(posts, key=lambda x: x.get("view_count") or 0, reverse=True):
        k = code(x["permalink"])
        if (x.get("view_count") or 0) < MIN_VIEWS or len(added) == 30:
            break
        if k in known or not x.get("media_url") or x.get("media_type") != "VIDEO":
            continue
        try:
            if not download(x["media_url"], f"{SRC}/{k}.mp4"):
                continue
        except Exception:
            continue
        added.append({"account": user, "url": x["permalink"], "views": x.get("view_count"), "likes": x.get("like_count"),
                      "comments": x.get("comments_count"), "caption": (x.get("caption") or "")[:200], "thumb": cover(x.get("thumbnail_url")),
                      "postedAt": x.get("timestamp"), "followers": followers, "hasFile": True})
    picks = json.load(open(picks_path))
    picks["picks"] += added
    picks.setdefault("expanded", []).append(user)
    json.dump(picks, open(picks_path, "w"), indent=2)
    extra += len(added)
    print(f"{user}: " + ", ".join(f"{k} {'FILE' if os.path.exists(f'{SRC}/{k}.mp4') else 'no file'}" for k in wanted) + f" | +{len(added)} more 100K+ videos")
print(f"DONE | files: {yes} yes, {no} no, {extra} extra")
