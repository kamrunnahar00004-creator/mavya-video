// Keyframed zoom must not wobble (founder 2026-11-11: "when it is zooming, it is shaking ... in the preview").
// Measured in Chrome on a still picture: the preview's zoom drifted 0.54 px every frame (Chrome snaps the scaled
// video to whole screen pixels), and values rounded to 0.1 made the zoom move in uneven steps. Fix: draw with exact
// values plus rotate(0.02deg), which keeps Chrome from snapping (0.13 px; a perfect zoom measures 0.06). Offline;
// the same in real Chrome: bash scripts/browser/zoom-preview.sh.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 7;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

finish('zoom-smooth-checks', EXPECTED, () => checks, () => {
  const a = load('src/lib/adjust.ts', { react: {} });
  const look = { zoom: 0, panX: 0, panY: 0, keys: [{ t: 0, zoom: 0, panX: 0, panY: 0 }, { t: 2, zoom: 32, panX: 40, panY: -10 }] };
  // Slow zoom near the start: exact values keep growing every frame; rounded ones stall and jump.
  const exact = [0.10, 0.11, 0.12, 0.13].map((t) => a.motionAt(look, t, true).zoom);
  ok(exact.every((z, i) => i === 0 || z > exact[i - 1]) && exact.some((z) => z !== Math.round(z * 10) / 10), 'drawing uses exact, ever-growing zoom values');
  ok([0.10, 0.11, 0.12].map((t) => a.motionAt(look, t).zoom).every((z) => z === Math.round(z * 10) / 10), 'the controls still show values rounded to 0.1');
  const pans = [0.10, 0.11, 0.12].map((t) => a.motionAt(look, t, true));
  ok(pans.every((m, i) => i === 0 || (m.panX > pans[i - 1].panX && m.panY < pans[i - 1].panY)) && pans.some((m) => m.panX !== Math.round(m.panX * 10) / 10), 'position moves by exact fractions too');
  const style = (t) => a.videoStyle(look, t).transform;
  const scale = (t) => Number(style(t).match(/scale\(([\d.]+)\)/)[1]);
  ok(scale(0.11) > scale(0.10) && scale(0.12) > scale(0.11) && String(scale(0.11)).length > 5, 'the preview transform carries the exact scale, frame by frame');
  ok(/scale\([\d.]+\) translate\([-\d.]+%, [-\d.]+%\) rotate\(0\.02deg\)/.test(style(1)), 'a zoomed preview gets rotate(0.02deg) so Chrome does not snap it to whole pixels');
  ok(a.videoStyle({ zoom: 20, panX: 0, panY: 0 }).transform.includes('rotate(0.02deg)'), 'also a fixed zoom (same picture as while it moves)');
  ok(a.videoStyle({ brightness: 10 }).transform === undefined, 'no zoom: no transform at all');
});
