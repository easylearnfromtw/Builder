const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/function chooseVisibleZoneMarkers\([\s\S]*?\n}\n(?=\n\/\* Catmull)/)?.[0];
assert.ok(source, 'Visible muscle-zone marker algorithm must exist in index.html');
const choose = vm.runInNewContext('(' + source + ')');

const W = 100, H = 70;
function canvas() { return new Uint8Array(W * H * 4); }
function rect(image, zid, side, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    image[i] = zid; image[i + 1] = side > 0 ? 255 : 0; image[i + 3] = 255;
  }
}
function onZone(image, marker, zid, side) {
  const i = (marker.y * W + marker.x) * 4;
  return image[i] === zid && (image[i + 1] >= 128 ? 1 : -1) === side && image[i + 3] === 255;
}

test('callout anchor is actually inside visible GPU muscle pixels, not the 3D average centre', () => {
  const img = canvas();
  rect(img, 1, 1, 6, 7, 38, 34);
  rect(img, 1, 1, 61, 32, 95, 64); // two disconnected visible muscle regions
  const p = choose(img, W, H, [1], 1).get(1);
  assert.ok(p);
  assert.ok(onZone(img, p, 1, 1), 'marker must lie inside one region, never in the gap');
});

test('left and right sides are not swapped when camera rotates', () => {
  const img = canvas();
  rect(img, 5, 1, 6, 10, 38, 62);
  rect(img, 5, -1, 57, 10, 95, 62);
  const positive = choose(img, W, H, [5], 1).get(5);
  const negative = choose(img, W, H, [5], -1).get(5);
  assert.ok(onZone(img, positive, 5, 1));
  assert.ok(onZone(img, negative, 5, -1));
  assert.ok(positive.x < negative.x);
});

test('invisible and tiny zones do not create misleading floating markers', () => {
  const img = canvas();
  rect(img, 3, 1, 10, 10, 12, 12);
  assert.equal(choose(img, W, H, [3, 7], 0).size, 0);
});

test('when side is unconstrained the largest visible half is selected', () => {
  const img = canvas();
  rect(img, 12, 1, 10, 10, 25, 25);
  rect(img, 12, -1, 50, 10, 95, 58);
  const p = choose(img, W, H, [12], 0).get(12);
  assert.ok(onZone(img, p, 12, -1));
});

test('marker is biased toward the interior of a curved muscle patch', () => {
  const img = canvas();
  rect(img, 9, 1, 10, 10, 80, 50);
  rect(img, 0, 1, 25, 20, 70, 50);
  const p = choose(img, W, H, [9], 1).get(9);
  assert.ok(onZone(img, p, 9, 1));
  assert.ok(p.y < 19 || p.x < 25 || p.x >= 70, 'must avoid the notch instead of pointing at its empty centroid');
});

const pectoralSource = html.match(/function validPectoralLabel\([\s\S]*?\n}\n/)?.[0];
assert.ok(pectoralSource, 'pectoral abdomen spill guard must be present in mesh generator');
const validPectoralLabel = vm.runInNewContext('(' + pectoralSource + ')');

test('pectoral abdomen spill guard excludes epigastric vertices', () => {
  assert.equal(validPectoralLabel(3, 0.04, 1.12, 0.10, 0.2), false);
  assert.equal(validPectoralLabel(3, 0.06, 1.23, 0.10, 0.2), false);
  assert.equal(validPectoralLabel(3, 0.18, 1.26, 0.10, 0.2), false);
  assert.equal(validPectoralLabel(3, 0.08, 1.305, 0.10, 0.2), true);
  assert.equal(validPectoralLabel(2, 0.10, 1.365, 0.12, 0.2), true);
  assert.equal(validPectoralLabel(1, 0.08, 1.435, 0.12, 0.2), true);
  assert.equal(validPectoralLabel(3, 0.10, 1.30, 0.10, 2.0), false);
  assert.equal(validPectoralLabel(9, 0.10, 1.12, 0.10, 2.0), true, 'back zones must not be cropped by pectoral correction');
});

const envelopesSource = html.match(/function muscleZoneEnvelopes\([\s\S]*?\n}\n/)?.[0];
const plausibleSource = html.match(/function plausibleMuscleVertex\([\s\S]*?\n}\n/)?.[0];
assert.ok(envelopesSource && plausibleSource, 'anatomical patch-envelope guard required');
const envelopes = vm.runInNewContext('(' + envelopesSource + ')');
const candidate = vm.runInNewContext('(' + plausibleSource + ')', { validPectoralLabel });

test('long back muscles cannot extrapolate into thigh or buttock', () => {
  const p = [{ o: { z: 9 }, bb: [-.20, 1.09, -.15, .20, 1.36, .05] },
    { o: { z: 10 }, bb: [-.08, .96, -.17, .08, 1.20, .01] }];
  const b = envelopes(p, 22);
  assert.equal(candidate(9, .12, 1.25, -.06, .2, b), true);
  assert.equal(candidate(9, .12, .78, -.06, .2, b), false);
  assert.equal(candidate(9, .12, 1.03, -.06, .2, b), false);
  assert.equal(candidate(10, 0, .80, -.06, .2, b), false);
  assert.equal(candidate(9, .12, 1.25, .3, .2, b), false);
});

test('leg muscles remain confined to their source anatomy', () => {
  const p = [{ o: { z: 17 }, bb: [-.20, .56, .01, .20, 1.00, .17] },
    { o: { z: 19 }, bb: [-.21, .82, -.14, .21, 1.05, .08] },
    { o: { z: 21 }, bb: [-.25, .18, -.15, .25, .51, .13] }];
  const b = envelopes(p, 22);
  assert.equal(candidate(17, .10, .8, .11, .1, b), true);
  assert.equal(candidate(17, .10, .4, .11, .1, b), false);
  assert.equal(candidate(19, .12, .96, -.07, .1, b), true);
  assert.equal(candidate(19, .12, 1.20, -.07, .1, b), false);
  assert.equal(candidate(21, .15, .40, -.05, .1, b), true);
  assert.equal(candidate(21, .15, .7, -.05, .1, b), false);
  assert.equal(candidate(21, .15, .40, -.05, 2, b), false);
});
