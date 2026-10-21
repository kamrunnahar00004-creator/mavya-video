"""Split each library video into its two parts: HOOK and DEMO (no CTA; founder 2026-10-21).
The cut point is the recipe's hook end (recipe.py, Gemini) snapped to the nearest real scene cut within 1 s,
so the hook clip ends exactly where the video cuts to the demo.
.data/sources/<code>.mp4 (full, KEPT) -> .data/hooks/<code>.mp4 (0..end) + .data/demos/<code>.mp4 (end..finish).
Writes ref["hookEnd"] and ref["hookCut"] ("recipe+scene" or "recipe").
Usage: split.py [<shortcode> ...]   default: every video that has a recipe."""
import json, os, re, subprocess, sys

ROOT = "/home/farhan/mavya-video"
FF = f"{ROOT}/node_modules/ffmpeg-static/ffmpeg"
SRC, HOOKS, DEMOS = f"{ROOT}/.data/sources", f"{ROOT}/.data/hooks", f"{ROOT}/.data/demos"
os.makedirs(HOOKS, exist_ok=True)
os.makedirs(DEMOS, exist_ok=True)
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]


def scene_cuts(path, until):
    out = subprocess.run([FF, "-hide_banner", "-i", path, "-t", f"{until:.2f}", "-vf", "select='gt(scene,0.25)',showinfo", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=180).stderr
    return [float(t) for t in re.findall(r"pts_time:([\d.]+)", out)]


def encode(src, dest, start=None, length=None):
    args = [FF, "-hide_banner", "-loglevel", "error", "-y"]
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", src]
    if length is not None:
        args += ["-t", f"{length:.3f}"]
    args += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest]
    subprocess.run(args, check=True, timeout=300)
    return os.path.getsize(dest) > 10_000


db = json.load(open(db_path))
want = set(sys.argv[1:])
todo = [r for r in db["references"] if r.get("recipe") and r.get("sourceUrl") and (not want or code(r["sourceUrl"]) in want)]
print(f"splitting {len(todo)} videos")
done = {}
for r in todo:
    k = code(r["sourceUrl"])
    src = f"{SRC}/{k}.mp4"
    if not os.path.exists(src):
        print("  no source", k)
        continue
    guess = float(r["recipe"]["hook"]["end"])
    cuts = [t for t in scene_cuts(src, guess + 1.2) if abs(t - guess) <= 1.0]
    end = min(cuts, key=lambda t: abs(t - guess)) if cuts else guess
    try:
        ok = encode(src, f"{HOOKS}/{k}.mp4", length=end) and encode(src, f"{DEMOS}/{k}.mp4", start=end)
    except Exception as e:
        print("  failed", k, str(e)[:120])
        continue
    if ok:
        done[r["id"]] = (round(end, 2), "recipe+scene" if cuts else "recipe")
        print(f"@{r.get('author')} {k}: hook 0-{end:.2f}s (Gemini {guess}s{', snapped to the scene cut' if cuts else ', no scene cut nearby'})")

# Merge onto the latest db (other scripts may have written meanwhile).
db2 = json.load(open(db_path))
for r in db2["references"]:
    if r["id"] in done:
        r["hookEnd"], r["hookCut"] = done[r["id"]]
tmp = db_path + ".tmp"
json.dump(db2, open(tmp, "w"), indent=2)
os.replace(tmp, db_path)
print(f"SPLIT DONE | {len(done)} of {len(todo)}")
