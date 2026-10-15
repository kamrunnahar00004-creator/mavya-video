"""Full recipe for a library hook: hook + on-screen text + demo style + CTA + why it works + hook generation prompt.
Gemini watches the full video (normal resolution: timing and detail matter here). Writes ref["recipe"].
Usage: recipe.py [N | <shortcode> ...]   N = sample size; shortcodes = specific videos; default all without a recipe."""
import base64, json, os, random, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = "/home/farhan/mavya-video"
SRC = f"{ROOT}/.data/sources"
MODEL = "gemini-flash-latest"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
KEY = env["GEMINI_API_KEY"]
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]
lock = threading.Lock()
LOW = os.environ.get("RES") == "low"  # RES=low: ~3x cheaper video tokens
FIELD = os.environ.get("FIELD", "recipe")  # where to store the result (e.g. recipeLow for comparisons)

PROMPT = """You are a short-form video producer. Break down this HOOK + DEMO marketing video into a production recipe
that another creator can follow to recreate the same video for THEIR OWN software product.

Be concrete and time-coded (seconds). Describe what the camera sees, not the identity of the person
(never describe the person's face, ethnicity or name; say "the creator"). Keep the person's actions, expression, outfit style and setting.

Sections:
- hook: the opening until the first cut to the demo.
- onScreenText: every text overlay in the whole video, exact words, when it shows, where on screen, style.
- demo: how the software is shown and each shot.
- cta: the call to action, if any.
- whyItWorks: 1 or 2 sentences from a marketer's angle (the tension, the payoff, why people watch to the end).
- hookPrompt: a prompt for an AI video model to generate a NEW hook clip in the same style. Use {CHARACTER} where the person goes.
  Include setting, lighting, framing, camera movement and the action beat by beat with timings. NO on-screen text in this prompt.
  Change small details (room, colors, props) so it is close but not a copy.

Caption (may help identify the product): {caption}"""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "hook": {"type": "OBJECT", "properties": {
            "end": {"type": "NUMBER", "description": "seconds where the hook ends"},
            "setting": {"type": "STRING"}, "lighting": {"type": "STRING"}, "outfit": {"type": "STRING"},
            "camera": {"type": "STRING", "description": "framing, angle, handheld or fixed, movement"},
            "mood": {"type": "STRING"},
            "spoken": {"type": "STRING", "description": "exact words spoken in the hook, empty if none"},
            "beats": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "start": {"type": "NUMBER"}, "end": {"type": "NUMBER"}, "action": {"type": "STRING"}}, "required": ["start", "end", "action"]}},
        }, "required": ["end", "setting", "lighting", "outfit", "camera", "mood", "spoken", "beats"]},
        "onScreenText": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "text": {"type": "STRING"}, "start": {"type": "NUMBER"}, "end": {"type": "NUMBER"},
            "position": {"type": "STRING", "description": "top, center, bottom..."}, "style": {"type": "STRING", "description": "font look, color, outline/box"}},
            "required": ["text", "start", "end", "position", "style"]}},
        "demo": {"type": "OBJECT", "properties": {
            "method": {"type": "STRING", "enum": ["phone_filming_laptop", "phone_filming_monitor", "phone_filming_phone", "screen_recording", "mixed"]},
            "product": {"type": "STRING"},
            "duration": {"type": "NUMBER"},
            "pacing": {"type": "STRING", "description": "how fast, how many cuts, where the wow moment lands"},
            "spoken": {"type": "STRING", "description": "voiceover during the demo, empty if none"},
            "shots": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "start": {"type": "NUMBER"}, "end": {"type": "NUMBER"},
                "onScreen": {"type": "STRING", "description": "what the software screen shows"},
                "interaction": {"type": "STRING", "description": "typing, clicking, scrolling, hands visible..."},
                "camera": {"type": "STRING", "description": "static, zoom in, pan, tilt..."}},
                "required": ["start", "end", "onScreen", "interaction", "camera"]}},
            "resultReveal": {"type": "STRING"},
        }, "required": ["method", "product", "duration", "pacing", "spoken", "shots", "resultReveal"]},
        "cta": {"type": "OBJECT", "properties": {
            "type": {"type": "STRING", "enum": ["comment_keyword", "link_in_bio", "follow", "none", "other"]},
            "text": {"type": "STRING"}, "at": {"type": "NUMBER", "description": "seconds, -1 if none"}},
            "required": ["type", "text", "at"]},
        "sound": {"type": "STRING", "description": "trending music, voiceover, sound effects"},
        "whyItWorks": {"type": "STRING"},
        "hookPrompt": {"type": "STRING"},
    },
    "required": ["hook", "onScreenText", "demo", "cta", "sound", "whyItWorks", "hookPrompt"],
}


def ask(video, caption):
    body = {"contents": [{"parts": [{"inline_data": {"mime_type": "video/mp4", "data": base64.b64encode(video).decode()}},
                                    {"text": PROMPT.replace("{caption}", (caption or "(none)")[:500])}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.2,
                                 **({"mediaResolution": "MEDIA_RESOLUTION_LOW"} if LOW else {})}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
    for attempt in range(6):
        try:
            return json.loads(json.load(urllib.request.urlopen(req, timeout=300))["candidates"][0]["content"]["parts"][0]["text"])
        except urllib.error.HTTPError as e:
            if e.code == 402:
                raise RuntimeError("OUT OF CREDITS")
            if e.code == 429 or e.code >= 500:
                time.sleep(20 * (attempt + 1)); continue
            raise RuntimeError(f"{e.code} {e.read()[:200]}")
    raise RuntimeError("gave up")


db = json.load(open(db_path))
live = [r for r in db["references"] if r.get("owner", "curated") == "curated" and not r.get("pending")
        and r.get("review", {}).get("verdict") != "drop" and os.path.exists(f"{SRC}/{code(r.get('sourceUrl') or 'x')}.mp4")]
args = sys.argv[1:]
if args and not args[0].isdigit():
    todo = [r for r in live if code(r["sourceUrl"]) in args]
else:
    todo = [r for r in live if "recipe" not in r]
    if args:
        random.seed(11)
        todo = random.sample(todo, int(args[0]))
print(f"recipes for {len(todo)} hooks")
done = [0]


def run(r):
    try:
        rec = ask(open(f"{SRC}/{code(r['sourceUrl'])}.mp4", "rb").read(), r.get("caption") or r.get("title"))
    except Exception as e:
        print("  error", r.get("author"), str(e)[:150]); return
    rec["model"], rec["at"] = MODEL, datetime.now(timezone.utc).isoformat()
    with lock:
        latest = json.load(open(db_path))
        for x in latest["references"]:
            if x["id"] == r["id"]:
                x[FIELD] = rec
        tmp = db_path + ".tmp"
        json.dump(latest, open(tmp, "w"), indent=2)
        os.replace(tmp, db_path)
        done[0] += 1
        print(f"[{done[0]}/{len(todo)}] @{r.get('author')} {r['sourceUrl']}")


with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(run, todo))
print("DONE |", done[0])
