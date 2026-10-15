"""Shorten summaries over 32 words to <= 30 (2-3 lines in the preview box). Keeps **bold** product, no dashes."""
import json, os, re, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
db_path = f"{ROOT}/.data/db.json"
lock = threading.Lock()
PROMPT = """Shorten this to at most 30 words, one or two sentences. Keep who does what in the hook, the product (keep its **double asterisks**) and what it's for. Drop secondary detail. No em dashes or en dashes. Reply with only the text.

{s}"""


def ask(text):
    body = {"contents": [{"parts": [{"text": PROMPT.replace("{s}", text)}]}], "generationConfig": {"temperature": 0.2}}
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": env["GEMINI_API_KEY"], "content-type": "application/json"})
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))["candidates"][0]["content"]["parts"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(15 * (attempt + 1)); continue
            raise


db = json.load(open(db_path))
todo = [r for r in db["references"] if r.get("summary") and len(r["summary"].split()) > 32]
print("tightening", len(todo))
done = [0]


def run(r):
    new = re.sub(r"\s*[—–]\s*", ", ", ask(r["summary"])).strip().strip('"')
    with lock:
        latest = json.load(open(db_path))
        for x in latest["references"]:
            if x["id"] == r["id"]:
                x["summary"] = new[:300]
        tmp = db_path + ".tmp"
        json.dump(latest, open(tmp, "w"), indent=2)
        os.replace(tmp, db_path)
        done[0] += 1
        if done[0] <= 4:
            print(f"- ({len(new.split())} words) {new}")


with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(run, todo))
print("DONE |", done[0])
