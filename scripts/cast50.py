"""Cast v2: 50 synthetic characters, top quality (gemini-3-pro-image, 2K, 9:16).
Writes the prompts to docs/CHARACTER_PROMPTS.md (source of truth) and images to .data/characters/<id>.jpg.
Usage: cast50.py prompts            write the prompt doc only
       cast50.py [id ...]           generate those (default: all missing)
Founder split: 80% women (50% white, 20% Asian, 20% Black, 10% Indian), 20% men (same proportions)."""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = "/home/farhan/mavya-video"
OUT = f"{ROOT}/.data/characters"
MODEL = "gemini-3-pro-image"

BASE = ("Ultra realistic raw phone photo, indistinguishable from a real unedited selfie. Vertical 9:16, shot on an iPhone front camera at arm's length, "
        "slight wide-angle lens distortion. Close-up: head and shoulders, the face fills about 40% of the frame, eyes in the upper third, sharp focus on the eyes. "
        "Real skin: visible pores, fine baby hairs and flyaways, slight under-eye shadows, uneven skin tone, tiny blemishes, natural asymmetry. "
        "No airbrushing, no beauty filter, no glossy AI look, no perfect symmetry, no studio lighting. Light phone-camera grain, natural light. "
        "An everyday person filming a casual TikTok, not a model. Looking straight at the camera, neutral friendly expression, mouth closed. "
        "No text, no logos or brand marks on anything, no watermark. A fictional person who does not resemble any real or famous person.")

# (id, who). Ethnicity is only used to generate the image; the website shows the first name only.
PEOPLE = [
    # Women, white (20)
    ("ava", "a white woman around 24 with long wavy light-brown hair, wearing an oversized grey hoodie"),
    ("emma", "a white woman around 28 with a blonde bob, wearing a black turtleneck"),
    ("chloe", "a white woman around 21 with long straight dark hair in a claw clip, wearing a plain navy crewneck sweatshirt"),
    ("sophie", "a white woman around 31 with auburn shoulder-length hair, wearing a cream knit cardigan"),
    ("lily", "a white woman around 25 with freckles and red curly hair, wearing a denim jacket"),
    ("grace", "a white woman around 33 with dark-blonde hair in a low bun and small glasses, wearing a beige blazer"),
    ("zoe", "a white woman around 22 with a brown messy bun, wearing a black athletic tank top"),
    ("hannah", "a white woman around 27 with long straight blonde hair, wearing a white t-shirt"),
    ("olivia", "a white woman around 29 with a dark brown lob and bangs, wearing a striped long-sleeve top"),
    ("ella", "a white woman around 23 with strawberry-blonde hair in two braids, wearing a lilac sweater"),
    ("mia", "a white woman around 26 with shoulder-length light-brown hair and a nose ring, wearing a black leather jacket"),
    ("isla", "a white woman around 35 with short pixie-cut dark hair, wearing a green chunky knit"),
    ("ruby", "a white woman around 20 with long dark-brown hair and curtain bangs, wearing a baby-blue hoodie"),
    ("nora", "a white woman around 30 with wavy honey-blonde hair, wearing a white linen shirt"),
    ("leah", "a white woman around 27 with long black hair and pale skin, wearing a burgundy turtleneck"),
    ("clara", "a white woman around 32 with light-brown hair in a sleek ponytail, wearing a grey blazer"),
    ("maddie", "a white woman around 22 with wavy blonde hair and a few freckles, wearing a pink zip hoodie"),
    ("kate", "a white woman around 34 with brown shoulder-length hair and thin glasses, wearing a navy cardigan"),
    ("josie", "a white woman around 25 with curly brown hair, wearing a mustard corduroy overshirt"),
    ("tess", "a white woman around 28 with straight ash-blonde hair, wearing a black hoodie"),
    # Women, Asian (8)
    ("mei", "an East Asian woman around 23 with long black hair and curtain bangs, wearing an oversized pastel sweater"),
    ("jiwoo", "a Korean woman around 26 with a sleek black bob, wearing a beige trench coat"),
    ("linh", "a Vietnamese woman around 29 with shoulder-length dark hair, wearing a linen shirt"),
    ("yuna", "a Japanese woman around 24 with dark-brown hair in a half-up style, wearing a white cardigan"),
    ("hana", "a Korean woman around 21 with long straight black hair, wearing a grey varsity sweatshirt with no lettering"),
    ("anna", "a Filipina woman around 30 with wavy black hair, wearing a coral blouse"),
    ("xiao", "a Chinese woman around 27 with a short black bob and round glasses, wearing a black knit top"),
    ("kim", "a Thai woman around 25 with long dark hair tied back, wearing a sage-green hoodie"),
    # Women, Black (8)
    ("amara", "a Black woman around 25 with shoulder-length box braids, wearing a mustard yellow sweater"),
    ("jordan", "a Black woman around 30 with a short natural afro and small gold earrings, wearing a white button-down shirt"),
    ("nia", "a Black woman around 22 with long sleek straight hair, wearing a cropped grey hoodie"),
    ("zuri", "a Black woman around 27 with long knotless braids in a high ponytail, wearing a black tank top"),
    ("imani", "a Black woman around 33 with a curly shoulder-length afro, wearing an olive utility jacket"),
    ("kayla", "a Black woman around 24 with a short pixie cut, wearing a lavender sweatshirt"),
    ("ayo", "a Black woman around 29 with locs tied up, wearing a terracotta knit sweater"),
    ("tiana", "a Black woman around 21 with long wavy hair, wearing a white zip-up hoodie"),
    # Women, Indian (4)
    ("priya", "an Indian woman around 26 with long straight black hair, wearing a cream knit sweater"),
    ("ananya", "an Indian woman around 31 with wavy dark hair to her shoulders, wearing a navy blouse"),
    ("diya", "an Indian woman around 23 with long dark hair in a braid, wearing a mustard kurta-style top"),
    ("riya", "an Indian woman around 28 with a dark-brown lob, wearing a black blazer"),
    # Men, white (5)
    ("jake", "a white man around 26 with short messy brown hair and light stubble, wearing a navy hoodie"),
    ("ethan", "a white man around 32 with short dark hair and a trimmed beard, wearing a grey crewneck"),
    ("liam", "a white man around 23 with wavy blond hair, wearing a white t-shirt"),
    ("owen", "a white man around 29 with a red-brown beard and short hair, wearing a flannel shirt"),
    ("max", "a white man around 35 with a shaved head and thin glasses, wearing a black sweater"),
    # Men, Asian (2)
    ("kenji", "an East Asian man around 27 with short black hair and round glasses, wearing a white t-shirt"),
    ("minho", "a Korean man around 24 with a textured black haircut, wearing an oversized beige shirt"),
    # Men, Black (2)
    ("marcus", "a Black man around 29 with a short fade and a neat beard, wearing an olive overshirt"),
    ("andre", "a Black man around 25 with short twists, wearing a grey hoodie"),
    # Men, Indian (1)
    ("arjun", "an Indian man around 28 with short black hair and stubble, wearing a navy polo shirt"),
]

# 50 different backgrounds, one per character.
PLACES = [
    "her bedroom with warm fairy lights and an unmade bed", "a bright minimal home office with a plant and a desk lamp",
    "a cozy dorm room with posters and a string of photos", "a sunny kitchen with a coffee machine and open shelves",
    "the driver's seat of a parked car, daylight through the windows", "a quiet coffee shop with warm lighting and blurred customers",
    "a gym with blurred equipment and mirrors", "a living room couch with a soft blanket and a window behind",
    "a small studio apartment with a white desk", "a hallway with framed prints on the wall",
    "a balcony with string lights at dusk", "an art studio with canvases and paint on the walls",
    "a dim bedroom lit by a sunset lamp", "a bright white bathroom with a round mirror",
    "a vintage clothing store with racks of clothes", "a home office with a big monitor and a bookshelf",
    "a laundromat with machines behind", "a bedroom with a vanity and soft daylight",
    "a cafe window seat on a rainy day", "a sofa in a dark living room lit by a TV glow",
    "a small bright studio apartment with plants", "a city balcony with buildings in daylight",
    "a home office with a bookshelf and warm lamp light", "a minimalist bedroom with a wooden headboard",
    "a university library study table", "an office meeting room with glass walls",
    "a bubble tea shop", "a kitchen table with a laptop and a mug",
    "a bedroom with a neutral wall and a mirror", "a modern open-plan office with blurred desks",
    "a kitchen counter at night with warm under-cabinet lights", "a hair salon chair with a mirror behind",
    "a sunlit living room with big plants", "a car passenger seat at night with city lights",
    "an apartment with an exposed brick wall and records", "a dorm hallway",
    "a room with green plants and a window with soft daylight", "a bookstore aisle",
    "a rooftop terrace at golden hour", "a co-working space with large windows",
    "a gaming desk setup with soft blue light", "a loft apartment with a brick wall and warm light",
    "a park bench with trees behind", "a woodworking garage with tools on the wall",
    "a recording corner with a microphone and foam panels", "a co-working space with plants and long tables",
    "a skate shop with boards on the wall", "a living room with a bookshelf and a floor lamp",
    "a barbershop with mirrors and chairs", "a train seat with a window and passing scenery",
]
assert len(PEOPLE) == len(PLACES) == 50 and len({p for _, p in [(0, x) for x in PLACES]}) == 50


def prompt(i):
    pid, who = PEOPLE[i]
    place = PLACES[i].replace("her ", "their ") if " man " in who else PLACES[i]
    return pid, f"{BASE} The person: {who}. Background: {place}, softly out of focus."


def write_doc():
    lines = ["# Character prompts (cast v2: 50, gemini-3-pro-image at 2K)", "",
             "Generated by `scripts/cast50.py`. Ethnicity is only used here to generate images; the website shows first names only.", ""]
    for i in range(50):
        pid, text = prompt(i)
        lines += [f"**{i + 1}. `{pid}`**", f"> {text}", ""]
    open(f"{ROOT}/docs/CHARACTER_PROMPTS.md", "w").write("\n".join(lines))
    print("wrote docs/CHARACTER_PROMPTS.md")


def make(i):
    env = dict(l.strip().split("=", 1) for l in open(f"{ROOT}/.env.local") if "=" in l and not l.startswith("#"))
    pid, text = prompt(i)
    body = {"contents": [{"parts": [{"text": text}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16", "imageSize": "2K"}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": env["GEMINI_API_KEY"], "content-type": "application/json"})
    try:
        out = json.load(urllib.request.urlopen(req, timeout=300))
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
    args = sys.argv[1:]
    if args == ["prompts"]:
        write_doc(); sys.exit()
    ids = [p for p, _ in PEOPLE]
    todo = [ids.index(a) for a in args] if args else [i for i in range(50) if not os.path.exists(f"{OUT}/{ids[i]}.jpg")]
    print(f"generating {len(todo)} with {MODEL} at 2K")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(make, todo))
