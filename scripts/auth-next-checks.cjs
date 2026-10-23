const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const {safeNext}=load('src/lib/auth-next.ts');
for(const bad of [null,'https://evil.invalid','//evil.invalid','/\t/evil.invalid','/\n/evil.invalid','/\\evil.invalid',' /studio'])assert.equal(safeNext(bad),'/studio');
assert.equal(safeNext('/settings/plans?paid=1'),'/settings/plans?paid=1');
assert.equal(safeNext('/studio/../settings'),'/settings');
console.log('PASS: shared same-origin auth destination rejects control characters and browser-normalized external paths');
