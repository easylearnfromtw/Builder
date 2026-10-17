const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('2K body renderer respects GPU pixel budgets and keeps portrait proportions', async () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    const result = await page.evaluate(() => ({
      portrait: Body.debug.dimensions(390, 844, 3),
      landscape: Body.debug.dimensions(1100, 900, 2),
      tiny: Body.debug.dimensions(390, 844, 1),
      state: Body.debug.state(),
    }));
    assert.deepEqual(errors, []);
    assert.equal(result.state.maxEdge, 2048);
    for (const [w, h, size] of [[390, 844, result.portrait], [1100, 900, result.landscape], [390, 844, result.tiny]]) {
      assert.ok(size.width > 0 && size.height > 0);
      assert.ok(Math.max(size.width, size.height) <= 2048);
      assert.ok(size.width * size.height <= result.state.pixelBudget + 5000);
      assert.ok(Math.abs(size.width / size.height - w / h) < 0.003);
    }
    // A capable 3x DPR phone should hit the 2K longest-edge ceiling.
    if (!result.state.lowPowerGPU) assert.equal(result.portrait.height, 2048);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
