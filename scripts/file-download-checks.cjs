// My files: Use, Download and Delete on every file that is the user's own (founder 2026-11-12: "like the use,
// download and delete. 3 options"). Download is a plain file download of the stored file under the item's name
// (src/lib/export-name.ts fileDownload); never for library reels, library songs or built-in characters (other
// people's work). Checks the helper and the history panel's wiring.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./check-module.cjs');
let checks=0;const ok=(c,m)=>{checks++;assert.ok(c,m);};const eq=(a,b,m)=>{checks++;assert.equal(JSON.stringify(a),JSON.stringify(b),m);};
const n=load('src/lib/export-name.ts');
eq(n.fileDownload('/api/media/abc-1.mov','My clip #2!'),{href:'/api/media/abc-1.mov?download=my_clip_2',file:'my_clip_2.mov'},'an upload saves under its name, with its own extension');
eq(n.fileDownload('/api/media/abc-1.mp4','Hook · 0:05').file,'hook_0_05.mp4','a generated hook saves as an mp4 with a safe name');
eq(n.fileDownload('/api/media/abc-1.png','Your photo').file,'your_photo.png','a photo keeps .png');
for(const src of ['/api/sounds/houdini','/characters/olivia.jpg','blob:https://x/1','https://cdn.example/reel.mp4','/api/media/x.mp4?preview=1',undefined])eq(n.fileDownload(src,'x'),null,`no download for ${src}`);
const mf=load('src/lib/my-files.ts');
ok(mf.isSongName('Houdini · Dua Lipa')&&mf.isSongName('Song · will.i.am')&&mf.isSongName('Song'),'library songs are songs, even when the artist ends like a file extension (Codex: "will.i.am")');
ok(!mf.isSongName('music-1.m4a')&&!mf.isSongName('voiceover.mp3'),'uploaded files are uploads');
const b=fs.readFileSync('src/components/history-panel.tsx','utf8');
ok(/const actions = \(key: string, fallback: string, src\?: string\) => \{[\s\S]{0,200}fileDownload\(src, name\)[\s\S]{0,300}download: saved\.href, downloadName: saved\.file/.test(b),'every item\'s ⋮ gets Download when its file is the user\'s own');
ok(/actions\(x\.key, r\.author \? `@\$\{r\.author\}` : r\.title, x\.kind === "upload" && r\.mediaId \? `\/api\/media\/\$\{r\.mediaId\}` : undefined\)/.test(b),'Hooks: only hooks the user uploaded, never library reels');
ok(/actions\(x\.key, name, f\.kind === "photo" \? `\/api\/media\/\$\{f\.mediaId\}` : undefined\)/.test(b),'Characters: only the user\'s photos, never built-in characters');
ok(/actions\(x\.key, `Hook · \$\{fmtTime\(x\.value\.g\.seconds\)\}`, x\.value\.g\.src\)/.test(b),'Generated hooks can be downloaded');
ok(/actions\(x\.key, `Demo · \$\{fmtTime\(demo\.seconds\)\}`, demo\.src\)/.test(b),'Demos can be downloaded');
ok(/actions\(x\.key, x\.value\.name, src\)/.test(b),'Uploaded clips can be downloaded');
ok(/actions\(x\.key, x\.value\.name, x\.value\.kind === "upload" \? x\.value\.src : undefined\)/.test(b),'Music: only sounds the user uploaded, never library songs (stored as copies too)');
ok(/downloadName=\{`\$\{exportFileName\(x\.hookText, x\.value\.at\)\}\.mp4`\}/.test(b),'Exported keeps its .mp4 name');
ok(/download=\{downloadName \?\? true\}/.test(b)&&/\{onUse && !inUse && [^\n]*Use<\/button>\}\s*\{download && [^\n]*Download<\/a>\}\s*<button[^\n]*Delete<\/button>/.test(b),'the menu: Use, Download, Delete, in that order');
ok(/<ItemMenu dark=\{false\} onUse=\{onUse\} inUse=\{inUse\} download=\{download\} downloadName=\{downloadName\} onDelete=\{onDelete\} \/>/.test(b),'sound rows pass Download to their menu');
if(checks!==21)throw Error(`file-download-checks: ${checks} checks ran, expected 21`);
console.log(`file-download-checks: ${checks} checks pass`);
