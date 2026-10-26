const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, stubs={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require(id){if(id in stubs)return stubs[id];throw Error(id);}});
  return module.exports;
}
const styles=load('src/lib/text-styles.ts');
const png=load('src/lib/text-png.ts',{'@/lib/studio-data':{FONTS:{},SYSTEM_FONTS:['Arial']},'@/lib/text-styles':styles});
assert.equal(styles.STYLE_PRESETS.length,48);
for(const preset of styles.STYLE_PRESETS){
  const look=preset.look('#ffffff','#111111');
  for(const [key,value] of Object.entries({...look.text,...look.box})){
    const prop=png.cssProperty(key);
    assert.match(prop,/^-?[a-z]+(?:-[a-z]+)*$/);
    assert.equal(prop.includes('--'),false,`${preset.id}: ${prop}`);
    assert.ok(png.textCss({[key]:value}).startsWith(`${prop}:`));
  }
}
assert.equal(png.cssProperty('WebkitTextStroke'),'-webkit-text-stroke');
assert.equal(png.cssProperty('WebkitTextFillColor'),'-webkit-text-fill-color');
assert.equal(png.cssProperty('WebkitBackgroundClip'),'-webkit-background-clip');
const {ffmpegAdjust}=load('src/lib/adjust.ts');
const filters=ffmpegAdjust({brightness:10,contrast:20,saturation:10,warmth:20},1080,1920);
assert.ok(filters[0].startsWith('colorchannelmixer'));assert.ok(filters[1].startsWith('eq='));assert.ok(filters[2].startsWith('colorchannelmixer'));
console.log('PASS: valid CSS property names across all 48 styles and Webkit stroke/fill/clip');
