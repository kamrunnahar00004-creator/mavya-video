"""AI fit check: Gemini compares each pending hook's full video against the founder's reference video
(the exact format to keep) and labels it "match" or "flag". Flagged videos go to the founder for review.
Nothing is removed here. Writes ref["ai"] = {verdict, reason, product, model, at}.
Usage: fitcheck.py [N]   (N = how many this run; default all). Waits on free-tier rate limits."""
import base64, json, os, random, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = "/home/farhan/mavya-video"
SRC = f"{ROOT}/.data/sources"
MODEL = "gemini-flash-latest"
REFERENCE = "DajwiOOtvDL"  # founder's sample: the exact format to keep (@blair.buildsthingss)
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
KEY = env["GEMINI_API_KEY"]
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]

PROMPT = """You check short-form videos for a library that must contain ONLY one format: HOOK + DEMO.

The format (VIDEO 1 is a correct example):
1. HOOK: the video opens with a person reacting or doing something (shocked, smug, excited, a relatable moment), with TEXT ON SCREEN or the person SPEAKING the hook.
2. DEMO: then a phone camera records a SOFTWARE product being used, e.g. filming a laptop, monitor or phone screen showing an app, website or AI tool. A direct screen recording also counts.

VIDEO 1 has no talking, but talking versions are also valid: a person may speak to camera or explain in a voiceover, as long as there is a person-led hook and then a software demo.

Now check VIDEO 2. Answer "match" only if it clearly has both parts: a person-led hook (on-screen text or spoken), then a demo of software being used.
Answer "flag" for anything else, including: no software demo (e.g. a talking head or vlog that never shows software in use), no person in the hook, a meme or slideshow, a physical product, a recruiting post, or if you are unsure.

Caption of VIDEO 2 (may help identify the product): {caption}

Also classify the STYLE of VIDEO 2: "talking" if a person speaks (to camera or as a voiceover explaining), "text_music" if nobody speaks and it relies on on-screen text with music or sound.

Answer in JSON. "reason" is one short sentence describing what VIDEO 2 shows; when flagging, say which part is missing or different."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "verdict": {"type": "STRING", "enum": ["match", "flag"]},
        "reason": {"type": "STRING"},
        "product": {"type": "STRING", "description": "The software product demoed in VIDEO 2, or empty"},
        "style": {"type": "STRING", "enum": ["talking", "text_music"]},
    },
    "required": ["verdict", "reason", "product", "style"],
}

import threading
STOP = threading.Event()  # set on out-of-credits / daily limit: every worker stops

ref_video = base64.b64encode(open(f"{SRC}/{REFERENCE}.mp4", "rb").read()).decode()


def ask(video_bytes, caption):
    body = {
        "contents": [{"parts": [
            {"text": "VIDEO 1 (correct example of the format):"},
            {"inline_data": {"mime_type": "video/mp4", "data": ref_video}},
            {"text": "VIDEO 2 (check this one):"},
            {"inline_data": {"mime_type": "video/mp4", "data": base64.b64encode(video_bytes).decode()}},
            {"text": PROMPT.replace("{caption}", (caption or "(none)")[:500])},
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0,
                             # Low-res video frames: ~3x cheaper, plenty to see a reaction and a screen demo.
                             "mediaResolution": "MEDIA_RESOLUTION_LOW"},
    }
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
    for attempt in range(6):
        try:
            out = json.load(urllib.request.urlopen(req, timeout=240))
            return json.loads(out["candidates"][0]["content"]["parts"][0]["text"])
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode(errors="ignore")
            if e.code == 429:
                if "PerDay" in msg or "per day" in msg.lower():
                    STOP.set(); raise RuntimeError("DAILY LIMIT reached, stopping")
                time.sleep(30 * (attempt + 1)); continue
            if e.code == 402:
                STOP.set(); raise RuntimeError("OUT OF CREDITS, stopping (add credit in AI Studio)")
            if e.code >= 500:
                time.sleep(10); continue
            raise RuntimeError(f"{e.code} {msg}")
    raise RuntimeError("gave up after retries")


db = json.load(open(db_path))
todo = [r for r in db["references"] if r.get("owner", "curated") == "curated" and r.get("pending") and "ai" not in r
        and code(r["sourceUrl"]) != REFERENCE and os.path.exists(f"{SRC}/{code(r['sourceUrl'])}.mp4")]
limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(todo)
if limit < len(todo):
    random.seed(7)
    todo = random.sample(todo, limit)  # spread the test sample across accounts
print(f"checking {len(todo)} videos with {MODEL}")

import threading
from concurrent.futures import ThreadPoolExecutor

counts = {"match": 0, "flag": 0, "error": 0}
lock = threading.Lock()  # one db.json write at a time


def check(r):
    if STOP.is_set():
        return
    k = code(r["sourceUrl"])
    try:
        res = ask(open(f"{SRC}/{k}.mp4", "rb").read(), r.get("caption") or r.get("title"))
    except Exception as e:
        with lock:
            counts["error"] += 1
            print(f"  error {r.get('author')} {k}: {str(e)[:200]}")
        return
    ai = {"verdict": res["verdict"], "reason": res["reason"][:200], "product": res.get("product", "")[:60], "style": res.get("style"), "model": MODEL,
          "at": datetime.now(timezone.utc).isoformat()}
    with lock:
        counts[ai["verdict"]] += 1
        latest = json.load(open(db_path))
        for x in latest["references"]:
            if x["id"] == r["id"]:
                x["ai"] = ai
        tmp = db_path + ".tmp"
        json.dump(latest, open(tmp, "w"), indent=2)
        os.replace(tmp, db_path)
        n = counts["match"] + counts["flag"]
        print(f"[{n}/{len(todo)}] {ai['verdict'].upper():5} {ai['style'] or '':10} @{r.get('author')} {r.get('views') or 0:>10,}  {ai['reason']}  | {r['sourceUrl']}")


with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(check, todo))
print("DONE |", counts)
