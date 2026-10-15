"""Generate the built-in character cast from docs/CHARACTER_PROMPTS.md (synthetic people, ours, commercial use).
Usage: characters.py [name ...]   only those (default: every character without an image yet; delete a png to redo it).
Images: .data/characters/<name>.png"""
import base64, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
OUT = f"{ROOT}/.data/characters"
MODEL = "gemini-3.1-flash-image"
env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
os.makedirs(OUT, exist_ok=True)

doc = open(f"{ROOT}/docs/CHARACTER_PROMPTS.md").read()
CAST = dict(re.findall(r"\*\*\d+\. `(\w+)\.png`\*\*.*?\n> (.+)", doc))


def make(name):
    body = {"contents": [{"parts": [{"text": CAST[name]}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": env["GEMINI_API_KEY"], "content-type": "application/json"})
    try:
        out = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        print("error", name, e.code, e.read()[:200]); return
    for part in out["candidates"][0]["content"]["parts"]:
        data = part.get("inlineData") or part.get("inline_data")
        if data:
            ext = "png" if "png" in data.get("mimeType", data.get("mime_type", "")) else "jpg"  # the model usually returns JPEG
            open(f"{OUT}/{name}.{ext}", "wb").write(base64.b64decode(data["data"]))
            print("saved", name)
            return
    print("no image for", name, json.dumps(out)[:200])


names = sys.argv[1:] or [n for n in CAST if not any(os.path.exists(f"{OUT}/{n}.{e}") for e in ("png", "jpg"))]
print(f"{len(CAST)} in cast, generating {len(names)}")
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(make, names))
