"""Rewrite every library summary: tighter, starts with the action, product name in **bold**, no dashes.
Text only (no video): uses the existing summary + caption. Keeps the old text in ref["summaryV1"]."""
import json, os, re, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
MODEL = "gemini-flash-latest"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
KEY = env["GEMINI_API_KEY"]
db_path = f"{ROOT}/.data/db.json"
lock = threading.Lock()

PROMPT = """Rewrite this description of a short-form marketing video for a library that marketers scan quickly.

Rules:
- 1 or 2 sentences, 2 to 3 lines when displayed (about 25 to 45 words).
- Start straight with the action: who does what in the hook. Never start with "The video", "This video" or "In this video".
- Then say what is demoed and what it's for (the payoff, e.g. "to sell on Etsy", "to find competitor ads").
- Put the software product's name in **double asterisks**, exactly once. If no product name is known, bold nothing.
- Plain, specific words. No hype, no emojis. Never use em dashes or en dashes; use commas or "then".
- Do not add facts that are not in the description or caption.

Description: {summary}
Caption: {caption}

Reply with only the rewritten description."""


def ask(summary, caption):
    body = {"contents": [{"parts": [{"text": PROMPT.replace("{summary}", summary).replace("{caption}", (caption or "(none)")[:400])}]}],
            "generationConfig": {"temperature": 0.2}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "content-type": "application/json"})
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))["candidates"][0]["content"]["parts"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            if e.code in (429,) or e.code >= 500:
                time.sleep(15 * (attempt + 1)); continue
            raise RuntimeError(f"{e.code} {e.read()[:200]}")
    raise RuntimeError("gave up")


db = json.load(open(db_path))
todo = [r for r in db["references"] if r.get("summary") and "summaryV1" not in r]
print("polishing", len(todo))
done = [0]


def run(r):
    try:
        new = ask(r["summary"], r.get("caption") or r.get("title"))
    except Exception as e:
        print("  error", r.get("author"), str(e)[:120]); return
    new = re.sub(r"\s*[—–]\s*", ", ", new).strip().strip('"')  # belt and braces: no dashes
    with lock:
        latest = json.load(open(db_path))
        for x in latest["references"]:
            if x["id"] == r["id"]:
                x["summaryV1"] = x["summary"]
                x["summary"] = new[:400]
        tmp = db_path + ".tmp"
        json.dump(latest, open(tmp, "w"), indent=2)
        os.replace(tmp, db_path)
        done[0] += 1
        if done[0] <= 8:
            print(f"- {new}")


with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(run, todo))
print(f"DONE | {done[0]} rewritten")
