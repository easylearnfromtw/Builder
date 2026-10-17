const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

// Visual regression: scan the *real* WebGL2 muscle model and verify that each
// displayed callout pin hits its own zone in the independent pointer pick pass.
test('GPU muscle labels point to their actual visible zones', { timeout: 140000 }, async t => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    // SwiftShader is CPU-backed in CI. Force the app's low-memory fallback so
    // a 2K render does not starve the event loop during an interaction test.
    await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    const hasWebGL2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    if (!hasWebGL2) { t.skip('WebGL2 unavailable in this Chromium environment'); return; }
    await page.evaluate(() => {
      document.querySelector('#welcome')?.remove();
      document.documentElement.classList.remove('locked');
      navigate('lift/chest');
    });
    try {
      await page.waitForFunction(() => Body.ready && Object.keys(Body.labelAnchors).length > 0, null, { timeout: 13000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        ready: Body.ready, ok: Body.ok, failed: Body.failed, model: Body.debug.state(),
        liftGroup: UI.liftGroup, mode: Body.mode, labels: Object.keys(Body.labelAnchors),
        domLabels: document.querySelectorAll('.bs-lab').length,
        stageHidden: document.querySelector('#bStage')?.hidden,
        noBody3d: document.documentElement.classList.contains('no-body3d'),
        version: document.querySelector('.release-label')?.textContent,
      }));
      throw new Error('WebGL body not ready for label validation: ' + JSON.stringify(diagnostics)
        + '; page errors: ' + JSON.stringify(errors) + '; original: ' + error.message);
    }
    await page.waitForTimeout(1700);
    const result = await page.evaluate(() => Object.entries(Body.labelAnchors).map(([id, point]) => ({
      id, expected: ZONE[id].i, actual: Body.debug.pickAt(point.x, point.y),
      onScreen: point.x >= 0 && point.y >= 0 && point.x < document.querySelector('#bStage').clientWidth
        && point.y < document.querySelector('#bStage').clientHeight,
    })));
    // Screenshot a real GPU render matching the iPhone's chest detail view.
    await page.locator('#bStage').screenshot({ path: '/tmp/jianren-chest-v3.png' });
    const anatomy = await page.evaluate(() => ({
      lowerBounds: Body.debug.zone('chest-lower', 1)?.lo,
      swatches: [...document.querySelectorAll('#bLabels .bs-region')]
        .map(e => ({ id: e.dataset.z, swatch: e.style.getPropertyValue('--zone-hue'),
          dot: getComputedStyle(e, '::before').backgroundColor })),
      group: Body.mode.group,
    }));
    assert.equal(anatomy.group, 'chest');
    assert.ok(anatomy.lowerBounds, 'lower pectoral mesh region must exist');
    assert.ok(anatomy.lowerBounds[1] >= 1.240,
      'inferior pectoral vertex must not leak down into the upper abdomen: ' + JSON.stringify(anatomy.lowerBounds));
    assert.equal(anatomy.swatches.length, 3, 'three separate chest annotation keys must appear');
    assert.equal(new Set(anatomy.swatches.map(x => x.swatch)).size, 3,
      'upper/middle/lower chest labels must have distinct colors');
    // Sample the actual GPU canvas at each (previously GPU-verified) zone
    // anchor. Testing chip CSS alone cannot detect indistinguishable muscle
    // shading under translucent clothing or lighting.
    const png = await page.locator('#bCanvas').screenshot();
    const rgb = await page.evaluate(async ({ png, anchors }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const sampling = document.createElement('canvas');
      sampling.width = image.naturalWidth; sampling.height = image.naturalHeight;
      const ctx = sampling.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const pix = ctx.getImageData(0, 0, sampling.width, sampling.height).data;
      const c = document.querySelector('#bCanvas');
      const kx = sampling.width / c.clientWidth, ky = sampling.height / c.clientHeight;
      return Object.fromEntries(Object.entries(anchors).map(([key, p]) => {
        const x = Math.max(0, Math.min(sampling.width - 1, Math.floor(p.x * kx)));
        const y = Math.max(0, Math.min(sampling.height - 1, Math.floor(p.y * ky)));
        return [key, Array.from(pix.slice(4 * (y * sampling.width + x), 4 * (y * sampling.width + x) + 3))];
      }));
    }, { png: png.toString('base64'), anchors: await page.evaluate(() => Body.labelAnchors) });
    console.log('Actual GPU-rendered pectoral zone RGB:', JSON.stringify(rgb));
    const samples = ['chest-upper', 'chest-mid', 'chest-lower'].map(id => rgb[id]);
    assert.ok(samples.every(rgb => Array.isArray(rgb) && rgb.length === 3),
      'all three chest zones must show a visible sampled pixel');
    console.log('Pectoral color key and inferior bounds:', JSON.stringify(anatomy));
    assert.ok(result.length > 0, 'at least one visible chest muscle must have a label');
    for (const p of result) {
      assert.ok(p.onScreen, p.id + ' anchor outside WebGL stage');
      assert.equal(p.actual, p.expected, p.id + ' label points at another muscle');
    }
    // The first regression covered only chest. Validate every other muscle
    // group from the real rotating WebGL model, not synthetic pixels.
    const totals = { chest: result.map(p => p.id) };
    for (const group of ['back', 'shoulders', 'arms', 'core', 'legs']) {
      await page.evaluate(g => navigate('lift/' + g), group);
      await page.waitForFunction(g => Body.mode.group === g && Object.keys(Body.labelAnchors).some(id => ZONE[id]?.g === g),
        group, { timeout: 12000 });
      await page.waitForTimeout(1500); // let the camera settle at the correct anatomical view
      const points = await page.evaluate(() => Object.entries(Body.labelAnchors).map(([id, p]) => ({
        id, group: ZONE[id]?.g, expected: ZONE[id]?.i,
        actual: Body.debug.pickAt(p.x, p.y),
        inView: p.x >= 0 && p.y >= 0 && p.x < document.querySelector('#bStage').clientWidth
          && p.y < document.querySelector('#bStage').clientHeight,
        y: p.y,
      })));
      const visible = points.filter(p => p.group === group);
      totals[group] = visible.map(p => p.id);
      assert.ok(visible.length > 0, group + ' has no visible muscle anchors');
      for (const p of visible) {
        assert.ok(p.inView, group + ': ' + p.id + ' outside stage');
        assert.equal(p.actual, p.expected, group + ': ' + p.id + ' pin does not match GPU muscle');
      }
      // Anatomical landmark ordering in the projected upright model.
      const Y = id => visible.find(p => p.id === id)?.y;
      if (group === 'back' && Y('back-traps') != null && Y('back-lower') != null)
        assert.ok(Y('back-traps') < Y('back-lower'), 'Trapezius must be above lumbar musculature');
      if (group === 'legs' && Y('leg-quads') != null && Y('leg-calves') != null)
        assert.ok(Y('leg-quads') < Y('leg-calves'), 'Quadriceps must be above calves');
    }
    console.log('Real-WebGL visible muscle IDs by group:', JSON.stringify(totals));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
