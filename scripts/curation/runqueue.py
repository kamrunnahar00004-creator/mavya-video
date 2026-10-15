import json, subprocess, sys

PICKS = "/home/farhan/mavya-video/.data/curation/picks.json"
ADD = sys.argv[1]
d = json.load(open(PICKS))
for u in sys.argv[2:]:
    if u not in d["queue"] and u not in d["accounts"]:
        d["queue"].append(u)
json.dump(d, open(PICKS, "w"), indent=2)

while True:
    d = json.load(open(PICKS))
    if not d["queue"]:
        break
    u = d["queue"][0]
    out = subprocess.run(["python3", "-I", ADD, u], capture_output=True, text=True).stdout
    print(out.strip())
    if "request limit" in out:
        print("RATE LIMITED, stopping. Queue:", d["queue"])
        break
    d = json.load(open(PICKS))
    d["queue"].remove(u)
    if "Invalid user id" in out:
        d["personal_skipped"].append(u)
    json.dump(d, open(PICKS, "w"), indent=2)
