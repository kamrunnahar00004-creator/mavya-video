// Migration 0019 on a real (in-memory) Postgres (founder 2026-11-08: demo captions must never be lost to a save from an
// older copy of the video). Checks the editor-save version compare under the row lock, that nobody can set the version
// through the patch, that old 3-argument calls behave as before, and that a finished generation moves the version on
// in the same write as the new hook. Offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const EXPECTED = 27;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table runs (id uuid primary key, user_id uuid not null, data jsonb not null, updated_at timestamptz);
  create table generations (id uuid primary key, user_id uuid, run_id uuid, state text, result jsonb, lease_token uuid, lease_until timestamptz, updated_at timestamptz);
`);
// What production has today (0018), then the new migration over it.
await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/0018_preserve_generated_hook.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/0019_edit_version_cas.sql'), 'utf8'));

const U = '00000000-0000-0000-0000-000000000001';
const R = '00000000-0000-0000-0000-0000000000aa';
const texts = (n) => Array.from({ length: n }, (_, i) => ({ id: 'd' + i, text: 'caption ' + i, start: i, end: i + 1 }));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const data = async () => (await one('select data from runs where id=$1', [R])).data;
const patch = async (p, base, check, save = null, mine = []) => (await one('select mavya_patch_run($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb) as r', [U, R, JSON.stringify(p), base, check, save, JSON.stringify(mine)])).r;
const patch3 = async (p) => (await one('select mavya_patch_run($1,$2,$3::jsonb) as r', [U, R, JSON.stringify(p)])).r;

await db.query('insert into runs values ($1,$2,$3::jsonb,now())', [R, U, JSON.stringify({ id: R, texts: texts(9), hook: { mode: 'upload', text: 'h' } })]);

// A video with no version yet takes the first editor save, which gives it one.
let r = await patch({ texts: texts(9) }, null, true);
const v1 = r.editVersion;
ok(typeof v1 === 'string' && v1.length === 36, 'first editor save gives the video a version');
// Copy B saves from v1; copy A, still on v1, is refused and changes nothing.
r = await patch({ texts: texts(9) }, v1, true);
const v2 = r.editVersion;
ok(v2 && v2 !== v1, 'each editor save moves the version on');
r = await patch({ texts: texts(4) }, v1, true);
eq(r.stale, true, 'a save from an older copy is refused');
eq((await data()).texts.length, 9, 'and removes no caption');
eq((await data()).editVersion, v2, 'and leaves the version alone');
r = await patch({ texts: texts(4) }, null, true);
eq(r.stale, true, 'a save naming no version is refused once the video has one');
// Nobody sets the version through the patch.
r = await patch({ texts: texts(9), editVersion: 'mine' }, v2, true);
ok(r.editVersion !== 'mine' && r.editVersion !== v2, 'an editor save cannot choose its own version');
const v3 = r.editVersion;
r = await patch3({ title: 'renamed', editVersion: 'mine' });
eq(r.editVersion, v3, 'a plain save cannot set the version either');
// Old 3-argument calls (the code deployed before this one) behave exactly as before: no check, no new version.
r = await patch3({ texts: texts(9) });
eq(r.editVersion, v3, 'an old-style call writes without moving the version');
eq(r.texts.length, 9, 'and writes what it was sent');
// 0018's rule still holds: a hook save without the generated clip keeps the stored clip.
await db.query(`update runs set data = data || '{"hook":{"mode":"upload","text":"h","generated":{"src":"/api/media/x.mp4","seconds":3,"at":"a"}}}'::jsonb where id=$1`, [R]);
r = await patch({ hook: { mode: 'upload', text: 'new words' } }, v3, true);
ok(r.hook.generated && r.hook.text === 'new words', 'a stale hook section still keeps the generated clip (0018)');
const v4 = r.editVersion;

// A save whose answer was lost: the page retries with its old base, naming that save. It is taken (the version came
// from this page), while another copy naming nothing, or other ids, is still refused.
r = await patch({ texts: texts(9) }, v4, true, 'page-save-1', []);
const v5 = r.editVersion;
eq(r.editSave, 'page-save-1', 'the save id is kept with the version it made');
r = await patch({ texts: texts(3) }, v4, true, 'other-copy', ['someone-else']);
eq(r.stale, true, 'an older copy naming other saves is refused');
r = await patch({ texts: texts(9) }, v4, true, 'page-save-2', ['page-save-1']);
ok(r.editVersion && r.editVersion !== v5 && r.editSave === 'page-save-2', 'the page\'s own retry after a lost answer is taken');
r = await patch({ texts: texts(9), editSave: 'forged' }, r.editVersion, true, 'page-save-3', []);
eq(r.editSave, 'page-save-3', 'the patch cannot set the save id');
const v6 = r.editVersion;
r = await patch3({ title: 't', editSave: 'forged' });
eq(r.editSave, 'page-save-3', 'a plain save cannot set the save id either');
r = await patch({ texts: texts(3) }, v4, true, 'x', 'not-an-array');
eq(r.stale, true, 'a malformed list of saves is ignored');

// A generation finishing moves the version on in the same write as the new hook.
const J = '00000000-0000-0000-0000-0000000000bb';
const T = '00000000-0000-0000-0000-0000000000cc';
await db.query(`insert into generations values ($1,$2,$3,'running',null,$4,null,now())`, [J, U, R, T]);
const v4b = v6;
const updatedAt = (await data()).updatedAt;
const result = { src: '/api/media/new.mp4', seconds: 5, at: 'b' };
const done = (await one('select mavya_complete_generation($1,$2,$3,$4,$5::jsonb,$6::jsonb) as r', [U, J, T, updatedAt, JSON.stringify({ hook: { mode: 'upload', text: '', generated: result }, texts: texts(9) }), JSON.stringify(result)])).r;
eq(done, result, 'the generation completes');
const after = await data();
eq(after.hook.generated, result, 'with the new hook');
eq([after.editSave, after.editPrev, after.editPrevSave], [null, v4b, 'page-save-3'], 'it records the version and the save it followed');
ok(after.editVersion && after.editVersion !== v4b, 'and a new version in the same write');
r = await patch({ texts: texts(2) }, v4b, true, 'late', ['page-save-3']);
eq(r.stale, true, 'a copy from before the generation cannot save over the new hook and captions');
eq(r.byGeneration, true, 'refused because of the generation alone (its version followed this page\'s)');
r = await patch({ texts: texts(2) }, v4, true, 'older', []);
eq(r.byGeneration, false, 'a copy from further back is told it is out of date');
eq((await data()).texts.length, 9, 'all captions kept');
r = await patch({ texts: texts(9) }, after.editVersion, true);
ok(r.editVersion && r.editVersion !== after.editVersion, 'the page that took the generation\'s version saves normally');
r = await patch({ texts: texts(2) }, v4b, true, 'late2', []);
eq(r.byGeneration, false, 'once another save followed the generation, a refused copy must reload, not save over it');

if (checks !== EXPECTED) { console.error(`edit-version-sql-checks: ${checks} checks ran, expected ${EXPECTED}`); process.exit(1); }
console.log(`edit-version-sql-checks: ${checks} checks pass`);
