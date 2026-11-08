// The hook's first frame (founder 2026-11-07: "the Summer room should never leak into it; the room etc. should be the
// hook's", and "the body should be Summer's, the clothes, background etc. the hook's"). Found: Gemini kept the character
// photo's bedroom and golden light, framed closer and added a hand; Kling then animated that. Checks src/lib/server/first-frame.ts with stand-in Gemini steps (offline), and that hookgen uses it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

const ff = load('src/lib/server/first-frame.ts');
let checks = 0;
const EXPECTED = 38;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

const PASS = { sameRoom: true, sameLight: true, sameFraming: true, sameAngle: true, sameHands: true, sameExpression: true, samePerson: true, problem: '' };
const ROOM = { ...PASS, sameRoom: false, sameLight: false, problem: "the bedroom from IMAGE 2 replaced the original's grey wall" };
const HAND = { ...PASS, sameHands: false, problem: 'a raised hand that IMAGE 1 does not show' };
const photo = Buffer.from('FULL-CHARACTER-PHOTO-WITH-BEDROOM');
const original = Buffer.from('ORIGINAL-FIRST-FRAME');
const b64 = (b) => b.toString('base64');

/** Stand-in Gemini: frames numbered by try, verdicts from a script; records what was sent. */
function fake(verdicts, { elapsed = () => 0, judgeThrows = false, imageThrowsOn = 0 } = {}) {
  const sent = { images: [], judged: [], ms: [], judgeMs: [] };
  let n = 0;
  const deps = {
    image: async (parts, ms) => { sent.images.push(parts); sent.ms.push(ms); if (imageThrowsOn === sent.images.length) throw new Error('image down'); return Buffer.from(`FRAME-${++n}`); },
    judge: async (parts, ms) => { sent.judged.push(parts); sent.judgeMs.push(ms); if (judgeThrows) throw new Error('judge down'); return verdicts[Math.min(sent.judged.length - 1, verdicts.length - 1)]; },
    elapsed,
  };
  return { deps, sent };
}
const datas = (parts) => parts.filter((p) => p.inline_data).map((p) => p.inline_data.data);
const texts = (parts) => parts.filter((p) => p.text).map((p) => p.text).join(' ');
const summer = { image: { data: b64(photo), mime: 'image/jpeg' }, words: '' };

finish('first-frame-checks', EXPECTED, () => checks, async () => {
  // The prompt: from IMAGE 2 only the person (face, hair, body); room, light, clothes, framing and hands from IMAGE 1.
  {
    const p = ff.swapPrompt(summer, 'a red oversized hoodie');
    ok(/From IMAGE 2 take ONLY the person themselves: their face, hair, skin tone, body shape, build and proportions/.test(p) && /Take NOTHING else from IMAGE 2: not its room, background, walls, furniture, lighting, colors, clothes, pose or camera distance/.test(p), 'prompt: the person and their body from IMAGE 2, nothing else');
    ok(/same camera angle \(the phone just as high or low, as far to the side, and tilted the same way/.test(p) && /sameAngle: the same camera angle/.test(ff.judgePrompt(summer)) && ff.VERDICT_SCHEMA.required.includes('sameAngle'), 'founder 2026-11-07: the camera angle is asked for and checked');
    ok(/same room, walls and everything behind them/.test(p) && /same camera distance and framing/.test(p) && /if no hand is visible in IMAGE 1, no hand in the result/.test(p) && /wearing a red oversized hoodie/.test(p), 'prompt: room, framing, hands and clothes from the hook');
    ok(/The last try was wrong: a raised hand/.test(ff.swapPrompt(summer, 'x', 'a raised hand')), 'prompt: names what the last try got wrong');
    ok(!/IMAGE 2/.test(ff.swapPrompt({ image: null, words: 'a tall man with a beard' }, 'x')), 'described person: no IMAGE 2 in the prompt');
  }
  // The whole character photo is sent, never a crop: their body stays theirs (founder 2026-11-07: a face crop would put
  // Summer's face on the hook person's body).
  {
    const { deps, sent } = fake([PASS]);
    const r = await ff.makeFirstFrame(deps, original, summer, 'a red hoodie');
    const sentData = datas(sent.images[0]);
    ok(sentData.length === 2 && sentData[1] === b64(photo) && /face, hair and body/.test(texts(sent.images[0])), 'the whole photo is sent, as the person with their body');
    ok(sentData[0] === b64(original) && r.tries === 1 && r.frame.toString() === 'FRAME-1', 'passes first time: one try, that frame');
    ok(datas(sent.judged[0]).includes(b64(original)) && datas(sent.judged[0]).includes(b64(Buffer.from('FRAME-1'))) && /face, hair and body/.test(texts(sent.judged[0])), 'the judge sees the original and the edit, and checks the body');
  }
  // An uploaded photo goes in the same way, with its own type.
  {
    const { deps, sent } = fake([PASS]);
    await ff.makeFirstFrame(deps, original, { image: { data: b64(photo), mime: 'image/png' }, words: '' }, 'x');
    ok(sent.images[0].some((p) => p.inline_data && p.inline_data.mime_type === 'image/png' && p.inline_data.data === b64(photo)), 'uploaded photo: sent whole with its type');
  }
  // The leak found 2026-11-07: the room comes back from IMAGE 2. The frame is made again, told why, and the fixed one kept.
  {
    const { deps, sent } = fake([ROOM, PASS]);
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(r.tries === 2 && r.frame.toString() === 'FRAME-2', `room leak: made again and the fixed frame kept (${r.tries} tries, ${r.frame})`);
    ok(texts(sent.images[1]).includes('The last try was wrong: the bedroom from IMAGE 2'), 'the retry names the leak');
  }
  // Never right: at most MAX_TRIES, and the closest one is kept.
  {
    const { deps, sent } = fake([ROOM, HAND, ROOM]);
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(ff.MAX_TRIES === 3 && r.tries === 3 && sent.images.length === 3, 'at most three tries');
    ok(r.frame.toString() === 'FRAME-2' && r.verdict === HAND, 'the closest frame is kept (one problem beats two)');
  }
  // No try passes: a frame with the hook's room and light beats one with Summer's room, even with more small checks right.
  {
    const LEAK = { ...PASS, sameRoom: false, problem: 'her bedroom' };
    const OFF = { ...PASS, sameFraming: false, sameAngle: false, sameExpression: false, problem: 'angle and expression' };
    const { deps } = fake([LEAK, OFF, LEAK]);
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(r.frame.toString() === 'FRAME-2' && r.verdict === OFF, `the hook's room wins over a closer frame in the wrong room (kept ${r.frame})`);
  }
  // Codex 2026-11-07: a wrong-light frame with every small check right tied with a right-light frame with none right.
  {
    const DIM = { ...PASS, sameLight: false, problem: 'golden light' };
    const BARE = { ...PASS, sameFraming: false, sameAngle: false, sameHands: false, sameExpression: false, problem: 'many small things' };
    const { deps } = fake([DIM, BARE, DIM]);
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(r.frame.toString() === 'FRAME-2', `the hook's light wins over every small check (kept ${r.frame})`);
  }
  // The check gets 30 s: at 15 s it timed out on a real run and the frame went to Kling unchecked (2026-11-07).
  ok(ff.JUDGE_MS >= 30_000 && ff.RETRY_MIN_MS >= ff.JUDGE_MS + 25_000, `check time ${ff.JUDGE_MS} ms, a retry needs ${ff.RETRY_MIN_MS} ms`);
  // Time (Codex 2026-11-07, two rounds): every image and every check is cut to what is left of FRAME_BUDGET_MS, so
  // sharing the files and starting Kling still fit in the hook's 210 s.
  {
    ok(ff.FRAME_BUDGET_MS + 30_000 <= 210_000, 'the frame budget leaves 30 s of the hook\'s 210 s for Kling');
    // A first try that starts late gets only what is left, minus the check's share.
    let t = 120_000;
    const a = fake([PASS], { elapsed: () => t });
    await ff.makeFirstFrame(a.deps, original, summer, 'x');
    ok(a.sent.ms[0] === ff.FRAME_BUDGET_MS - 120_000 - ff.JUDGE_MS, `late first try cut to ${a.sent.ms[0]} ms`);
    // A retry at 100 s: its image and its check together end by the deadline (the clock moves by each call's limit).
    let u = 0;
    const b = fake([ROOM, PASS], { elapsed: () => u });
    const image = b.deps.image, judge = b.deps.judge;
    b.deps.image = async (parts, ms) => { const r = await image(parts, ms); u += b.sent.images.length === 1 ? 90_000 : ms; return r; };
    b.deps.judge = async (parts, ms) => { const r = await judge(parts, ms); u += b.sent.judged.length === 1 ? 10_000 : ms; return r; };
    await ff.makeFirstFrame(b.deps, original, summer, 'x');
    ok(b.sent.images.length === 2 && u <= ff.FRAME_BUDGET_MS, `a retry at 100 s and its check end at ${u} ms, by the ${ff.FRAME_BUDGET_MS} ms deadline`);
    // Not enough left for a retry: none starts.
    let v = 0;
    const c = fake([ROOM, PASS], { elapsed: () => v });
    c.deps.judge = async (parts, ms) => { c.sent.judged.push(parts); v = ff.FRAME_BUDGET_MS - ff.RETRY_MIN_MS + 1; return ROOM; };
    const r = await ff.makeFirstFrame(c.deps, original, summer, 'x');
    ok(r.tries === 1 && c.sent.images.length === 1, 'late: no retry');
    // No time at all for a first try: it fails rather than run past the hook's deadline.
    const d = fake([PASS], { elapsed: () => ff.FRAME_BUDGET_MS });
    let threw = false;
    try { await ff.makeFirstFrame(d.deps, original, summer, 'x'); } catch (e) { threw = e instanceof ff.FrameOutOfTime; }
    ok(threw && d.sent.images.length === 0, 'out of time before the first try: no call, FrameOutOfTime');
  }
  // Codex 2026-11-07: a retry that fails keeps the frame already made; a failed first try still fails.
  {
    const { deps } = fake([ROOM, PASS], { imageThrowsOn: 2 });
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(r.frame.toString() === 'FRAME-1' && r.tries === 2, 'failed retry: the first frame is kept');
    const f = fake([PASS], { imageThrowsOn: 1 });
    let threw = false;
    try { await ff.makeFirstFrame(f.deps, original, summer, 'x'); } catch { threw = true; }
    ok(threw, 'failed first try: the error is raised');
  }
  // Codex 2026-11-07: a described person is judged against the description, not a missing IMAGE 2.
  {
    const { deps, sent } = fake([PASS]);
    await ff.makeFirstFrame(deps, original, { image: null, words: 'a tall man with a red beard' }, 'x');
    const t = texts(sent.judged[0]);
    ok(t.includes('matching this description: a tall man with a red beard') && !t.includes('IMAGE 2'), 'described person: judged against the words');
  }
  // The check failing never blocks the hook: the frame is kept.
  {
    const { deps } = fake([PASS], { judgeThrows: true });
    const r = await ff.makeFirstFrame(deps, original, summer, 'x');
    ok(r.frame.toString() === 'FRAME-1' && r.tries === 1, 'judge down: frame kept, no retry');
  }
  // Founder 2026-11-08: three frames all kept the original creator, the best went to Kling anyway and the video showed
  // the creator's real face. A frame the check calls someone else is never sent on.
  {
    const NOBODY = { ...PASS, samePerson: false, problem: 'The person from IMAGE 2 was not applied; the original subject remains' };
    // Every try the wrong person: one extra try, then WrongPerson (nothing returned for Kling).
    const a = fake([NOBODY]);
    let err = null;
    try { await ff.makeFirstFrame(a.deps, original, summer, 'x'); } catch (e) { err = e; }
    ok(err instanceof ff.WrongPerson && err.message === ff.WRONG_PERSON_MESSAGE, 'never the character: fails with WrongPerson');
    ok(ff.PERSON_TRIES === 4 && a.sent.images.length === 4 && a.sent.judged.length === 4, `one extra try only for the person (${a.sent.images.length} tries)`);
    ok(/not the person in IMAGE 2/.test(texts(a.sent.images[3])) && !/not the person in IMAGE 2/.test(texts(a.sent.images[2])), 'the extra try is told the person is wrong');
    // The extra try gets the character: it is used.
    const b = fake([NOBODY, NOBODY, NOBODY, HAND]);
    const r = await ff.makeFirstFrame(b.deps, original, summer, 'x');
    ok(r.tries === 4 && r.frame.toString() === 'FRAME-4' && r.verdict === HAND, 'the extra try with the character is kept');
    // Normal hooks take no longer: once a try has the character, still at most three tries.
    const c = fake([HAND, HAND, HAND]);
    const r2 = await ff.makeFirstFrame(c.deps, original, summer, 'x');
    ok(r2.tries === 3 && c.sent.images.length === 3, 'with the character in a try: no extra try (no added time)');
    // A frame with the character beats one with everything else right but someone else's face.
    const WRONG = { ...PASS, samePerson: false, problem: 'not her' };
    const LEAK = { ...PASS, sameRoom: false, sameLight: false, problem: 'her bedroom' };
    const d = fake([WRONG, LEAK, WRONG]);
    const r3 = await ff.makeFirstFrame(d.deps, original, summer, 'x');
    ok(r3.frame.toString() === 'FRAME-2' && r3.tries === 3, `the character wins over a closer frame of someone else (kept ${r3.frame})`);
    // No time for the extra try: fails rather than run long or send the wrong face.
    let t = 0;
    const e = fake([NOBODY], { elapsed: () => t });
    const judge = e.deps.judge;
    e.deps.judge = async (parts, ms) => { const v = await judge(parts, ms); if (e.sent.judged.length === 3) t = ff.FRAME_BUDGET_MS - ff.RETRY_MIN_MS + 1; return v; };
    let err2 = null;
    try { await ff.makeFirstFrame(e.deps, original, summer, 'x'); } catch (x) { err2 = x; }
    ok(err2 instanceof ff.WrongPerson && e.sent.images.length === 3, 'no time for the extra try: WrongPerson, no fourth call');
    // A failed retry after a wrong-person frame: WrongPerson, not the wrong frame.
    const f = fake([NOBODY], { imageThrowsOn: 2 });
    let err3 = null;
    try { await ff.makeFirstFrame(f.deps, original, summer, 'x'); } catch (x) { err3 = x; }
    ok(err3 instanceof ff.WrongPerson, 'failed retry after the wrong person: WrongPerson');
    // The check down after a wrong-person frame: the new unchecked frame, never the known wrong one.
    const g = fake([NOBODY, PASS]);
    const gj = g.deps.judge;
    g.deps.judge = async (parts, ms) => { if (g.sent.judged.length === 1) throw new Error('judge down'); return gj(parts, ms); };
    const r4 = await ff.makeFirstFrame(g.deps, original, summer, 'x');
    ok(r4.frame.toString() === 'FRAME-2' && r4.verdict === null, 'check down after the wrong person: the unchecked frame, not the wrong one');
    // The job fails and refunds at once, with this message, and does not run the fallback (more minutes, same frame).
    const jobs = fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8');
    ok(/else if \(error instanceof WrongPerson\) await transition\(job, "failed", error\.message\);\n\s+else await transition\(job, job\.fallback_used \? "failed" : "fallback"\);/.test(jobs), 'job: WrongPerson fails at once, no fallback');
    ok(/import \{ WrongPerson \} from "@\/lib\/server\/first-frame";/.test(jobs) && fs.readFileSync('src/lib/server/hookgen.ts', 'utf8').includes('const { frame } = await makeFirstFrame({'), 'job and hookgen are wired to it');
  }
  // hookgen uses it: the whole photo, the checked frame to Kling, the old one-shot swap and the crop gone.
  {
    const src = fs.readFileSync('src/lib/server/hookgen.ts', 'utf8');
    ok(/await makeFirstFrame\(\{/.test(src) && !/swapFirstFrame/.test(src) && !/crop=/.test(src) && !/faceCrop/.test(src), 'hookgen: makeFirstFrame used, no unchecked swap, no crop');
    ok(/judge: \(parts, ms\) => geminiJSON/.test(src) && /signal: workSignal\(Math\.max\(1000, ms\)\)/.test(src), 'hookgen: the image and the check get their time limits');
  }
});
