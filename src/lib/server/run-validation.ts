/** Reject broken sections before they can make a saved run impossible to open. */
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min = 0, max = 3600) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const string = (v: unknown) => typeof v === "string" && v.length <= 10000;
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const mediaId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}\.(mp4|mov|webm|jpg|png|mp3|m4a|aac|wav)$/.test(v);
const localVideo = (v: unknown) => typeof v === "string" && (/^\/api\/media\/[0-9a-f.-]+$/.test(v) || /^\/samples\/[A-Za-z0-9._-]+\.mp4$/.test(v));

function adjust(v: unknown): boolean {
  if (!object(v)) return false;
  const ranges: Record<string, [number, number]> = { brightness: [-50, 50], contrast: [-50, 50], saturation: [-50, 50], warmth: [-50, 50], zoom: [0, 100], panX: [-100, 100], panY: [-100, 100], speed: [0.5, 2], volume: [0, 100] };
  for (const [key, [lo, hi]] of Object.entries(ranges)) if (!optional(v[key], (n) => number(n, lo, hi))) return false;
  return optional(v.flip, (b) => typeof b === "boolean") && optional(v.keys, (ks) => Array.isArray(ks) && ks.length <= 500 && ks.every((k) => object(k) && number(k.t) && number(k.zoom, 0, 100) && number(k.panX, -100, 100) && number(k.panY, -100, 100)));
}

function clip(v: unknown): boolean {
  return object(v) && nullable(v.mediaId, mediaId) && string(v.name) && ["video", "image", "placeholder"].includes(String(v.kind)) && number(v.offset) && nullable(v.length, number);
}

function face(v: unknown): boolean {
  if (!object(v)) return false;
  return v.kind === "photo" ? mediaId(v.mediaId) : v.kind === "ai" ? number(v.index, 0, 69) && Number.isInteger(v.index) : v.kind === "character" ? typeof v.id === "string" && /^[A-Za-z0-9_-]+$/.test(v.id) : v.kind === "described" && string(v.text);
}

function hook(v: unknown): boolean {
  if (!object(v) || !["upload", "avatar"].includes(String(v.mode)) || !string(v.text) || !nullable(v.clip, clip)) return false;
  if (!optional(v.face, (f) => nullable(f, face)) || !optional(v.adjust, adjust)) return false;
  if (!optional(v.start, number) || !optional(v.end, number) || (typeof v.start === "number" && typeof v.end === "number" && v.end <= v.start)) return false;
  for (const key of ["original", "note", "describe", "color", "font", "textStyle"]) if (!optional(v[key], string)) return false;
  return optional(v.generated, (g) => object(g) && localVideo(g.src) && number(g.seconds, 0.1) && string(g.at)) && optional(v.describeReady, (b) => typeof b === "boolean");
}

function demo(v: unknown): boolean {
  if (!object(v) || !nullable(v.clip, clip) || !["none", "laptop", "overlay"].includes(String(v.frame))) return false;
  return optional(v.clips, (cs) => Array.isArray(cs) && cs.length <= 100 && cs.every((c) => {
    if (!object(c) || !string(c.id) || !string(c.label) || !optional(c.mediaId, mediaId) || !optional(c.src, localVideo) || !optional(c.adjust, adjust)) return false;
    for (const key of ["name", "hint", "camera", "text"]) if (!optional(c[key], string)) return false;
    for (const key of ["seconds", "start", "end", "target"]) if (!optional(c[key], number)) return false;
    return optional(c.steps, (s) => Array.isArray(s) && s.every(string)) && !(typeof c.start === "number" && typeof c.end === "number" && c.end <= c.start);
  }));
}

function texts(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 200 && v.every((t) => object(t) && string(t.id) && string(t.text) && number(t.start) && number(t.end) && (t.end as number) > (t.start as number) && number(t.x, -100, 200) && number(t.y, -100, 200) && number(t.size, 0.1, 100) && string(t.font) && string(t.color) && string(t.style));
}

export function validRunPatch(body: unknown): boolean {
  return object(body) && optional(body.hook, hook) && optional(body.demo, demo) && optional(body.texts, texts)
    && optional(body.sounds, (v) => Array.isArray(v) && v.every(object))
    && optional(body.project, (v) => nullable(v, (p) => object(p) && Array.isArray(p.texts) && (Array.isArray(p.clips) || Array.isArray(p.slots))));
}
