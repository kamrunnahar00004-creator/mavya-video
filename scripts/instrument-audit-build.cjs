// Manual measurement only. Instrument a credential-free physical build copy, never a Git checkout.
const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=path.resolve(process.argv[2]||'.');
if(fs.existsSync(path.join(root,'.git'))||fs.readdirSync(root).some(f=>f.startsWith('.env')&&f!=='.env.example'))throw Error('Use a credential-free physical copy outside Git');
const names=new Set(['RunView','RunPreview','ClipEditor','WholePlayer','WholeControls','Filmstrip','TextOverlay','timeline','soundPieces']);
for(const f of ['src/components/run-view.tsx','src/components/run-preview.tsx','src/components/editor-tools.tsx','src/lib/edit.ts','src/lib/sound.ts']){
 const full=path.join(root,f),s=fs.readFileSync(full,'utf8'),ast=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true),insert=[];
 function visit(n){if((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n))&&n.name&&names.has(n.name.text)&&n.body)insert.push([n.body.getStart(ast)+1,n.name.text]);ts.forEachChild(n,visit)}visit(ast);
 let result=s;for(const [at,name] of insert.sort((a,b)=>b[0]-a[0]))result=result.slice(0,at)+`\n if(typeof window!=="undefined"){const w=window as unknown as {__renders?: Record<string,number>};if(w.__renders)w.__renders["${name}"]=(w.__renders["${name}"]||0)+1;}\n`+result.slice(at);
 fs.writeFileSync(full,result);
}
