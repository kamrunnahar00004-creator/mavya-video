// Measurement only: diagnostic counters in an isolated, credential-free copy.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]);
execFileSync(process.execPath,[path.join(__dirname,'instrument-audit-build.cjs'),root]);
const file=path.join(root,'src/components/editor-tools.tsx'),source=fs.readFileSync(file,'utf8');
const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['AdvancedSettings','WholeMedia','WholeAudio','WholeTransport','WholePlayhead','ClockedMotionRow','AdjustmentControl']),edits=[];
function visit(n){if((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n))&&n.name&&names.has(n.name.text)&&n.body)edits.push([n.body.getStart(tree)+1,n.name.text]);ts.forEachChild(n,visit)}visit(tree);
let next=source;for(const [at,name] of edits.sort((a,b)=>b[0]-a[0]))next=next.slice(0,at)+`\nif(typeof window!=="undefined"){const w=window as unknown as {__renders?:Record<string,number>};if(w.__renders)w.__renders["${name}"]=(w.__renders["${name}"]||0)+1;}\n`+next.slice(at);
fs.writeFileSync(file,next);
