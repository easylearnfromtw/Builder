const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

// Visual regression: scan the *real* WebGL2 muscle model and verify that each
// displayed callout pin hits its own zone in the independent pointer pick pass.
test('GPU muscle labels point to their actual visible zones', { timeout: 65000 }, async t => {
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
    assert.ok(result.length > 0, 'at least one visible chest muscle must have a label');
    for (const p of result) {
      assert.ok(p.onScreen, p.id + ' anchor outside WebGL stage');
      assert.equal(p.actual, p.expected, p.id + ' label points at another muscle');
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
