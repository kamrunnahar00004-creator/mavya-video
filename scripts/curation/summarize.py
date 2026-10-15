"""Two-line summary for every live library hook (shown to users in the preview), plus the style label
(talking / text_music) where it's missing. Writes ref["summary"], and ref["ai"]["style"] if absent.
Usage: summarize.py   (5 in parallel; stops cleanly on out-of-credits)."""
import base64, json, os, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
SRC = f"{ROOT}/.data/sources"
MODEL = "gemini-flash-latest"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
KEY = env["GEMINI_API_KEY"]
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]
STOP = threading.Event()
lock = threading.Lock()

PROMPT = """Watch this short-form marketing video. It is a hook + product demo video.

1. Write "summary": exactly 1 or 2 short sentences for a marketer browsing a library, describing what happens.
   Start with how the video opens (who does what, any on-screen text or voiceover), then what is demoed and on what.
   Name the product if you can tell (the caption may help). Plain words, no hype, no emojis, never say "VIDEO".
   Example: "The video starts with a woman reacting with an on-screen hook and voiceover, then demonstrates a quiz website built on Replit."
2. "style": "talking" if a person speaks (to camera or as a voiceover), "text_music" if nobody speaks and it relies on on-screen text with music or sound.

Caption: {caption}"""

SCHEMA = {"type": "OBJECT", "properties": {"summary": {"type": "STRING"}, "style": {"type": "STRING", "enum": ["talking", "text_music"]}},
          "required": ["summary", "style"]}


def ask(video, caption):
    body = {"contents": [{"parts": [{"inline_data": {"mime_type": "video/mp4", "data": base64.b64encode(video).decode()}},
                                    {"text": PROMPT.replace("{caption}", (caption or "(none)")[:500])}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0,
                                 "mediaResolution": "MEDIA_RESOLUTION_LOW"}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
    for attempt in range(6):
        try:
            return json.loads(json.load(urllib.request.urlopen(req, timeout=240))["candidates"][0]["content"]["parts"][0]["text"])
        except urllib.error.HTTPError as e:
            if e.code == 402:
                STOP.set(); raise RuntimeError("OUT OF CREDITS")
            if e.code == 429 or e.code >= 500:
                time.sleep(20 * (attempt + 1)); continue
            raise RuntimeError(f"{e.code} {e.read()[:200]}")
    raise RuntimeError("gave up")


db = json.load(open(db_path))
todo = [r for r in db["references"] if r.get("owner", "curated") == "curated" and not r.get("pending")
        and r.get("review", {}).get("verdict") != "drop" and not r.get("summary") and os.path.exists(f"{SRC}/{code(r.get('sourceUrl') or 'x')}.mp4")]
print(f"summarizing {len(todo)} hooks")
done = [0]


def run(r):
    if STOP.is_set():
        return
    try:
        res = ask(open(f"{SRC}/{code(r['sourceUrl'])}.mp4", "rb").read(), r.get("caption") or r.get("title"))
    except Exception as e:
        print("  error", r.get("author"), str(e)[:150]); return
    with lock:
        latest = json.load(open(db_path))
        for x in latest["references"]:
            if x["id"] == r["id"]:
                x["summary"] = res["summary"].strip()[:300]
                x.setdefault("ai", {"verdict": "match", "reason": "", "model": MODEL, "at": ""})
                x["ai"].setdefault("style", res["style"])
                if not x["ai"].get("style"):
                    x["ai"]["style"] = res["style"]
        tmp = db_path + ".tmp"
        json.dump(latest, open(tmp, "w"), indent=2)
        os.replace(tmp, db_path)
        done[0] += 1
        print(f"[{done[0]}/{len(todo)}] @{r.get('author')}: {res['summary'][:140]}")


with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(run, todo))
print(f"DONE | {done[0]} summaries")
