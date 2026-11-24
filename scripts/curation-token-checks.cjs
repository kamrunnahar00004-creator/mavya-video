// The library scripts reach Instagram with the Page token first (founder 2026-11-24: META_ACCESS_TOKEN was invalidated
// by a Facebook session reset; META_PAGE_TOKEN kept working for business_discovery). The user token is only a fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
let checks = 0;
for (const f of ['add.py', 'files.py', 'thumbs.py', 'redownload.py']) {
  const s = fs.readFileSync(`scripts/curation/${f}`, 'utf8');
  checks++; assert.ok(s.includes('"access_token": env.get("META_PAGE_TOKEN") or env["META_ACCESS_TOKEN"]'), `${f} uses the Page token first`);
  checks++; assert.ok(!/"access_token": env\["META_ACCESS_TOKEN"\]/.test(s), `${f} never uses only the user token`);
}
console.log(`curation-token-checks: ${checks} checks pass`);
