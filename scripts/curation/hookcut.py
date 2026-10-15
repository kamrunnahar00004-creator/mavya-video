"""Cut the hook out of each downloaded Reel, keep only the hook clip, delete the full video.
.data/sources/<code>.mp4 (full, temporary) -> .data/hooks/<code>.mp4 (hook only, private).
Hook end = first scene cut between 0.7s and 5s; no cut found = first 3s.
Founder rule: if a hook can't be cut, the video is deleted and the hook leaves the library."""
import json, os, re, subprocess

ROOT = "/home/farhan/mavya-video"
FF = f"{ROOT}/node_modules/ffmpeg-static/ffmpeg"
SRC, HOOKS = f"{ROOT}/.data/sources", f"{ROOT}/.data/hooks"
os.makedirs(HOOKS, exist_ok=True)
db_path = f"{ROOT}/.data/db.json"
code = lambda link: link.rstrip("/").split("/")[-1]


def first_cut(path):
    out = subprocess.run([FF, "-hide_banner", "-i", path, "-t", "6", "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=120).stderr
    times = [float(t) for t in re.findall(r"pts_time:([\d.]+)", out)]
    return next((t for t in times if 0.7 <= t <= 5), None)


def demo_frames(src, k):
    """3 small stills from after the hook (at 40/60/80% of the video): the demo part, for the fit check and recipes."""
    out = subprocess.run([FF, "-hide_banner", "-i", src], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        return 0
    dur = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    n = 0
    for i, f in enumerate((0.4, 0.6, 0.8)):
        dest = f"{HOOKS}/{k}.demo{i + 1}.jpg"
        subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{dur * f:.2f}", "-i", src, "-frames:v", "1",
                        "-vf", "scale=360:-2", "-q:v", "5", dest], timeout=60)
        n += os.path.exists(dest)
    return n


def cut(src, dest, end):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-t", f"{end:.2f}", "-c:v", "libx264", "-crf", "26",
                    "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", dest], check=True, timeout=120)
    return os.path.getsize(dest) > 10_000


db = json.load(open(db_path))
refs = {code(r["sourceUrl"]): r for r in db["references"] if r.get("sourceUrl")}
done = failed = 0
for name in sorted(os.listdir(SRC)):
    k, src = name[:-4], f"{SRC}/{name}"
    ref = refs.get(k)
    if not ref:  # removed from the library meanwhile
        os.remove(src)
        continue
    try:
        found = first_cut(src)
        end = found or 3.0
        ok = cut(src, f"{HOOKS}/{k}.mp4", end)
        if ok:
            demo_frames(src, k)
    except Exception as e:
        print("  cut failed", k, e)
        ok, found = False, None
    os.remove(src)  # never keep the full video
    if ok:
        ref["hookEnd"] = round(end, 2)
        ref["hookCut"] = "scene" if found else "default"
        done += 1
        print(f"{ref.get('author')}: hook 0-{end:.2f}s ({'cut found' if found else 'no cut, first 3s'})")
    else:
        failed += 1
        os.system(f"python3 -I {ROOT}/scripts/curation/drop.py 'hook could not be cut' https://www.instagram.com/reel/{k}/ > /dev/null")

db2 = json.load(open(db_path))  # merge onto the latest db (drop.py may have written)
for r in db2["references"]:
    src_ref = refs.get(code(r.get("sourceUrl", "")))
    if src_ref and "hookEnd" in src_ref:
        r["hookEnd"], r["hookCut"] = src_ref["hookEnd"], src_ref["hookCut"]
tmp = db_path + ".tmp"
json.dump(db2, open(tmp, "w"), indent=2)
os.replace(tmp, db_path)
print(f"HOOKS DONE | cut {done}, failed {failed}")
