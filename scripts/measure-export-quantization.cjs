// Offline real export reproducer. Records the existing short-piece timing defect without a paid worker call.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
async function measure(out){
 const {plan,stepArgs,finalArgs,countArgs,countFrames}=await import('../render/render.mjs'),ff=require('ffmpeg-static');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mavya-audit-piece-'));
 const run=args=>execFileSync(ff,['-nostdin','-y','-v','error',...args],{timeout:60000,maxBuffer:8*1024*1024});
 try{
  const src=path.join(dir,'source.mp4');
  run(['-f','lavfi','-i','color=black:s=720x1280:r=120:d=0.5','-vf',"drawbox=color=red:t=fill:enable='gte(t,0.45)'",'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',src]);
  const spec={width:720,height:1280,fps:30,total:0.5,segments:[{gap:0,speed:1,volume:0,look:null,pieces:Array.from({length:10},(_,i)=>({start:i*0.05,end:(i+1)*0.05}))}],sounds:[],overlays:[]};
  const files=plan(spec).map((step,i)=>{const f=path.join(dir,'step'+i+'.mkv'),s={file:src,hasAudio:false,duration:0.5},c=path.join(dir,'count'+i+'.txt');run(countArgs(spec,step,s,c));run(stepArgs(spec,step,s,f,countFrames(fs.readFileSync(c,'utf8'))));return f});
  const list=path.join(dir,'list.txt');fs.writeFileSync(list,files.map(f=>`file '${f}'`).join('\n'));
  const out=path.join(dir,'out.mp4');run(finalArgs(spec,list,{sounds:[],overlays:[]},out));
  const pixels=file=>run(['-ss','0.466667','-i',file,'-vf','crop=2:2:100:100','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  const source=pixels(src),output=pixels(out),frameBytes=file=>run(['-i',file,'-vf','scale=2:2','-f','rawvideo','-pix_fmt','rgb24','pipe:1']).length/12;
  const result={setup:'Actual offline 720p ffmpeg; 120fps source, ten contiguous 50ms pieces, final30fps/500ms. Source turns red for final50ms.',sourceFinalPixel:[...source.subarray(0,3)],outputFinalPixel:[...output.subarray(0,3)],intermediateFrames:files.map(frameBytes),finalFrames:frameBytes(out),expectedFinalRed:source[0]>150,actualFinalRed:output[0]>150};
  console.log(JSON.stringify(result));if(out)fs.writeFileSync(out,JSON.stringify(result,null,2));return result;
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
exports.measure=measure;
if(require.main===module)measure(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1});
