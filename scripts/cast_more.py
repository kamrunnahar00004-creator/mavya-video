"""Cast batch 2: 50 more characters (same look as batch 1: gemini-3.1-flash-image, phone-selfie realism).
Founder split: 40 women (20 white, 8 Asian, 8 Black, 4 Indian; 30 of them influencer-attractive, never sexual), 10 men (5/2/2/1).
Each has a background not used by anyone else. Prompts are appended to docs/CHARACTER_PROMPTS.md.
Usage: cast_more.py [id ...]   (default: all missing). Images: .data/characters/<id>.jpg"""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
OUT = f"{ROOT}/.data/characters"
MODEL = "gemini-3.1-flash-image"

BASE = ("Ultra realistic raw phone photo, indistinguishable from a real unedited selfie. Vertical 9:16, shot on an iPhone front camera at arm's length, "
        "slight wide-angle lens distortion. Close-up: head and shoulders, the face fills about 40% of the frame, eyes in the upper third. "
        "Real skin: visible pores, fine baby hairs and flyaways, natural asymmetry. No airbrushing, no beauty filter, no glossy AI look, no studio lighting. "
        "Light phone-camera grain, natural light. Looking straight at the camera, friendly expression, mouth closed. "
        "Casual, modest clothing, fully covered, nothing revealing, not sexual or suggestive. "
        "No text, no logos or brand marks on anything, no watermark. A fictional person who does not resemble any real or famous person.")
PRETTY = ("Very attractive in a natural way, like a popular lifestyle influencer: clear healthy skin that still shows real texture, "
          "well-groomed brows, light natural makeup, nicely styled hair, bright eyes.")
EVERYDAY = "An everyday person filming a casual TikTok, not a model: slight under-eye shadows, uneven skin tone, tiny blemishes."

# (id, who, attractive)
PEOPLE = [
    # Women, white (20): 15 attractive, 5 everyday
    ("olivia", "a white woman around 26 with long glossy chestnut hair and a fitted cream ribbed sweater", True),
    ("ella", "a white woman around 23 with long wavy blonde hair and a soft white knit sweater", True),
    ("mia", "a white woman around 25 with sleek dark-brown hair past her shoulders and a black crewneck top", True),
    ("isla", "a white woman around 27 with honey-blonde curtain bangs and a light-blue button-down shirt", True),
    ("ruby", "a white woman around 22 with long red hair in soft waves and a forest-green cardigan", True),
    ("nora", "a white woman around 28 with a sleek brown bob and a camel turtleneck", True),
    ("leah", "a white woman around 24 with long black hair, fair skin and a grey oversized sweater", True),
    ("clara", "a white woman around 29 with light-brown hair in a high ponytail and a white athleisure zip jacket", True),
    ("maddie", "a white woman around 21 with long blonde hair and a baby-pink crewneck sweatshirt", True),
    ("harper", "a white woman around 26 with dark-blonde wavy hair and a denim shirt", True),
    ("sienna", "a white woman around 25 with long auburn hair and a beige knit vest over a white tee", True),
    ("bella", "a white woman around 23 with long brunette hair in a claw clip and a lilac hoodie", True),
    ("freya", "a white woman around 27 with platinum-blonde shoulder-length hair and a black blazer over a white tee", True),
    ("eva", "a white woman around 24 with long straight light-brown hair and a sage-green sweater", True),
    ("quinn", "a white woman around 30 with wavy brown hair and gold hoop earrings, wearing a navy knit", True),
    ("kate", "a white woman around 34 with brown shoulder-length hair and thin glasses, wearing a navy cardigan", False),
    ("josie", "a white woman around 25 with curly brown hair, wearing a mustard corduroy overshirt", False),
    ("tess", "a white woman around 31 with straight ash-blonde hair, wearing a black hoodie", False),
    ("molly", "a white woman around 22 with a messy brown bun and freckles, wearing a grey college-style sweatshirt with no lettering", False),
    ("piper", "a white woman around 33 with short dark hair, wearing a striped long-sleeve top", False),
    # Women, Asian (8): 6 attractive, 2 everyday
    ("yuna", "a Japanese woman around 24 with long glossy black hair and soft bangs, wearing a white cardigan", True),
    ("hana", "a Korean woman around 23 with long straight dark-brown hair, wearing a pastel-yellow knit", True),
    ("sora", "a Korean woman around 26 with a sleek shoulder-length bob, wearing a black turtleneck", True),
    ("mina", "a Chinese woman around 25 with long wavy black hair, wearing a cream blouse", True),
    ("aiko", "a Japanese woman around 22 with dark hair in a half-up style, wearing a light-grey hoodie", True),
    ("tala", "a Filipina woman around 27 with long dark wavy hair, wearing a soft coral sweater", True),
    ("xiao", "a Chinese woman around 30 with a short black bob and round glasses, wearing a black knit top", False),
    ("kim", "a Thai woman around 28 with dark hair tied back, wearing a sage-green hoodie", False),
    # Women, Black (8): 6 attractive, 2 everyday
    ("zuri", "a Black woman around 25 with long knotless braids, wearing a white ribbed top with a light cardigan", True),
    ("imani", "a Black woman around 27 with a defined curly shoulder-length afro, wearing an olive utility jacket", True),
    ("simone", "a Black woman around 24 with long sleek straight hair, wearing a cream knit sweater", True),
    ("jada", "a Black woman around 23 with long wavy hair and gold studs, wearing a lavender hoodie", True),
    ("nala", "a Black woman around 26 with a short tapered natural cut and hoop earrings, wearing a terracotta sweater", True),
    ("tiana", "a Black woman around 22 with long box braids in a half-up style, wearing a white zip hoodie", True),
    ("kayla", "a Black woman around 31 with a short pixie cut, wearing a grey sweatshirt", False),
    ("ayo", "a Black woman around 33 with locs tied up, wearing a denim jacket", False),
    # Women, Indian (4): 3 attractive, 1 everyday
    ("diya", "an Indian woman around 24 with long glossy dark hair, wearing a soft peach blouse", True),
    ("riya", "an Indian woman around 26 with a dark-brown wavy lob, wearing a black blazer over a white tee", True),
    ("isha", "an Indian woman around 23 with long dark hair in a loose braid, wearing a mustard sweater", True),
    ("meera", "an Indian woman around 32 with shoulder-length dark hair and small glasses, wearing a navy cardigan", False),
    # Men (10): 5 white, 2 Asian, 2 Black, 1 Indian
    ("liam", "a white man around 23 with wavy blond hair, wearing a white t-shirt", False),
    ("owen", "a white man around 29 with a red-brown beard and short hair, wearing a flannel shirt", False),
    ("max", "a white man around 35 with a shaved head and thin glasses, wearing a black sweater", False),
    ("noah", "a white man around 26 with short dark-brown hair and light stubble, wearing a grey hoodie", False),
    ("ryan", "a white man around 31 with short light-brown hair, wearing a navy quarter-zip", False),
    ("minho", "a Korean man around 24 with a textured black haircut, wearing an oversized beige shirt", False),
    ("jun", "a Chinese man around 28 with short black hair and glasses, wearing a black crewneck", False),
    ("andre", "a Black man around 25 with short twists, wearing a grey hoodie", False),
    ("malik", "a Black man around 30 with a clean fade and a short beard, wearing a white overshirt", False),
    ("arjun", "an Indian man around 28 with short black hair and stubble, wearing a navy polo shirt", False),
]

# 50 backgrounds, none used by batch 1.
PLACES = [
    "a hallway with framed prints on the wall", "a balcony with string lights at dusk", "an art studio with canvases on the walls",
    "a bedroom lit by a warm sunset lamp", "a bright white bathroom with a round mirror", "a vintage clothing store with racks of clothes",
    "a laundromat with machines behind", "a bedroom vanity with soft daylight", "a cafe window seat on a rainy day",
    "a dark living room lit by a TV glow", "a minimalist bedroom with a wooden headboard", "a university library study table",
    "an office meeting room with glass walls", "a bubble tea shop", "a kitchen table with a laptop and a mug",
    "a hair salon with mirrors behind", "a sunlit living room with big plants", "a car passenger seat at night with city lights outside",
    "a dorm hallway", "a rooftop terrace at golden hour", "a park bench with trees behind",
    "a ceramics studio with shelves of pottery", "a flower shop with buckets of flowers", "a record store with vinyl racks",
    "a yoga studio with wooden floors", "a bakery counter with pastries", "a farmers market stall",
    "a ski lodge with a fireplace", "a rainy city street under an awning", "a subway platform",
    "a campus lawn with old buildings", "a desk by a window at night with city lights", "a pastel bedroom with a mirror",
    "a boho living room with macrame on the wall", "an outdoor cafe terrace", "a greenhouse full of plants",
    "a music practice room with a guitar on the wall", "a cozy reading nook with a window seat", "a marble kitchen island",
    "a vintage diner booth", "an airport gate seating area", "a hotel room with white curtains",
    "a woodworking garage with tools on the wall", "a recording corner with a microphone and foam panels", "a skate shop with boards on the wall",
    "a barbershop with mirrors and chairs", "a train seat by the window with passing scenery", "a home office with a standing desk and a big monitor",
    "a backyard patio with a string of lights", "a busy open office kitchen",
]
assert len(PEOPLE) == len(PLACES) == 50 and len(set(PLACES)) == 50
assert sum(1 for p in PEOPLE if p[2]) == 30


def prompt(i):
    pid, who, pretty = PEOPLE[i]
    return pid, f"{BASE} {PRETTY if pretty else EVERYDAY} The person: {who}. Background: {PLACES[i]}, softly out of focus."


def make(i):
    env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
    pid, text = prompt(i)
    body = {"contents": [{"parts": [{"text": text}]}], "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": env["GEMINI_API_KEY"], "content-type": "application/json"})
    try:
        out = json.load(urllib.request.urlopen(req, timeout=240))
    except urllib.error.HTTPError as e:
        print("error", pid, e.code, e.read()[:200]); return
    for part in out["candidates"][0]["content"]["parts"]:
        data = part.get("inlineData") or part.get("inline_data")
        if data:
            open(f"{OUT}/{pid}.jpg", "wb").write(base64.b64decode(data["data"]))
            print("saved", pid)
            return
    print("no image for", pid, json.dumps(out)[:200])


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    doc = f"{ROOT}/docs/CHARACTER_PROMPTS.md"
    with open(doc, "a") as f:
        f.write("\n\n# Batch 2 (50 more, gemini-3.1-flash-image)\n\n" + "\n".join(f"**`{prompt(i)[0]}`**\n> {prompt(i)[1]}\n" for i in range(50)))
    ids = [p[0] for p in PEOPLE]
    todo = [ids.index(a) for a in sys.argv[1:]] if sys.argv[1:] else [i for i in range(50) if not os.path.exists(f"{OUT}/{ids[i]}.jpg")]
    print(f"generating {len(todo)}")
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(make, todo))
