// Run: node --test tests/bottom-navigation.cjs (requires Playwright).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

for (const touch of [false, true]) {
  test(`bottom navigation stays fixed while scrolling (${touch ? 'touch' : 'mouse'})`, async () => {
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(join(__dirname, '..', 'index.html')));
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: touch, hasTouch: touch });
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(() => {
        document.querySelector('#welcome')?.remove();
        document.documentElement.classList.remove('locked');
      });
      await page.waitForTimeout(700);
      const rect = () => page.locator('#tabbar').evaluate(el => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      });
      const before = await rect();
      for (const y of [500, 150, 700, 0]) {
        await page.evaluate(y => scrollTo(0, y), y);
        await page.waitForTimeout(550);
        assert.deepEqual(await rect(), before, `navigation moved after scrolling to ${y}`);
      }
      for (const tab of ['lift', 'run', 'log', 'stats', 'today']) {
        await page.locator(`#tabseg button[data-v="${tab}"]`).click();
        assert.equal(await page.locator(`#tabseg button[data-v="${tab}"]`).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator(`#v-${tab}`).isVisible(), true);
      }
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(600);
      const rotated = await rect();
      assert.ok(rotated.x >= 0 && rotated.x + rotated.width <= 844);
      assert.ok(rotated.y >= 0 && rotated.y + rotated.height <= 390);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
