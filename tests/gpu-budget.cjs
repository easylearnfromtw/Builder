// Pure GPU-budget regression tests; no browser or Playwright dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const definition = html.match(/  function renderDimensions\([^]*?\n  }/);
assert.ok(definition, 'body GPU budget function exists');
function dimensions({ coarse, width, height, dpr, maxSize = 4096 }) {
  const context = { Math, coarseGPU: coarse, maxCanvasPixels: coarse ? 960000 : 2400000, maxRenderSize: maxSize, devicePixelRatio: dpr };
  return vm.runInNewContext(`${definition[0]}; renderDimensions(${width}, ${height}, ${dpr})`, context);
}
test('high-DPR touch devices stay below the mobile pixel budget', () => {
  for (const [width, height] of [[390, 844], [430, 932], [1024, 1366], [2400, 1800]]) {
    const r = dimensions({ coarse: true, width, height, dpr: 4 });
    assert.ok(r.width * r.height <= 961000, `${width}x${height} rendered ${r.width}x${r.height}`);
    assert.ok(r.width <= width * 1.5 + 1);
    assert.ok(r.height <= height * 1.5 + 1);
  }
});
test('desktop devices honor pixel and hardware limits', () => {
  for (const [width, height] of [[1920, 1080], [3000, 2400], [9000, 6000]]) {
    const r = dimensions({ coarse: false, width, height, dpr: 3, maxSize: 2048 });
    assert.ok(r.width * r.height <= 2402000);
    assert.ok(r.width <= 2048 && r.height <= 2048);
  }
});
test('normal DPR does not get upscaled, and picking still uses CSS dimensions', () => {
  const r = dimensions({ coarse: true, width: 390, height: 480, dpr: 1 });
  assert.deepEqual({ ...r }, { width: 390, height: 480 });
  assert.match(html, /px \/ cssW \* t\.w/);
  assert.match(html, /py \/ cssH/);
});
test('touch animation throttles GPU submission while leaving picks before drawing', () => {
  assert.match(html, /coarseGPU \? 2 : 4/);
  assert.match(html, /now - lastPaint >= 1000 \/ 30/);
  assert.ok(html.indexOf('const z = readPick(pickAt[0], pickAt[1]);') < html.indexOf('now - lastPaint >= 1000 / 30'));
});
test('page JavaScript syntax is valid', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.doesNotThrow(() => new Function(s[1]));
});
