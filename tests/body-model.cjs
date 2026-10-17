// Run: node --test tests/body-model.cjs (requires Playwright). WebGL is optional: the list-based path is tested without it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function withApp(check, { noGL = false } = {}) {
  const server = createServer((req, res) => {
    if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(join(__dirname, '..', 'index.html'))); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (noGL) await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, opts) { return /webgl/.test(type) ? null : get.call(this, type, opts); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.documentElement.classList.remove('locked'); });
    await check(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}

test('parts → detailed muscles; picks carry across parts and survive a reload', () => withApp(async p => {
  await p.locator('#tabseg button[data-v="lift"]').click();
  await p.locator('[data-act="lift-group"][data-g="chest"]').click();
  await p.waitForURL('**/#lift/chest');
  assert.equal(await p.locator('.zchip').count(), 4);
  await p.locator('.zchip[data-z="chest-upper"]').click();
  await p.waitForURL('**/#lift/chest/chest-upper');
  const ids = await p.locator('#exList [data-group-ex]').evaluateAll(els => els.map(e => e.dataset.groupEx));
  for (const id of ['incline-db', 'incline-bench', 'low-cable-fly', 'bench']) assert.ok(ids.includes(id), `${id} listed for upper chest`);
  await p.locator('[data-group-ex="incline-bench"]').check();
  assert.match(await p.locator('#liftTray').innerText(), /已選 1 個動作/);
  // a muscle replaces the part in history, so Back returns to the whole body
  await p.goBack(); await p.waitForURL('**/#lift');
  assert.equal(await p.locator('[data-act="lift-group"]').count(), 6);
  await p.locator('[data-act="lift-group"][data-g="shoulders"]').click();
  await p.waitForURL('**/#lift/shoulders');
  await p.locator('[data-group-ex="lateral"]').check();
  assert.match(await p.locator('#liftTray').innerText(), /已選 2 個動作/);
  await p.reload();
  await p.evaluate(() => { document.querySelector('#welcome')?.remove(); document.documentElement.classList.remove('locked'); });
  assert.match(await p.locator('#liftTray').innerText(), /已選 2 個動作/);
  assert.equal(await p.locator('[data-group-ex="lateral"]').isChecked(), true);
  await p.locator('[data-act="group-start"]').click();
  assert.deepEqual(await p.evaluate(() => S.active.items.map(i => i.eid)), ['incline-bench', 'lateral']);
  assert.equal(await p.evaluate(() => S.active.title), '胸・肩 訓練');
  assert.equal(await p.locator('#liftTray').isVisible(), false);
}));

test('without WebGL the model hides and every part and muscle stays reachable', () => withApp(async p => {
  await p.locator('#tabseg button[data-v="lift"]').click();
  await p.waitForFunction(() => document.documentElement.classList.contains('no-body3d'));
  assert.equal(await p.locator('#bStage').isVisible(), false);
  await p.locator('[data-act="lift-group"][data-g="legs"]').click();
  await p.waitForURL('**/#lift/legs');
  assert.ok(await p.getByRole('heading', { name: '腿部訓練', exact: true }).isVisible());
  await p.locator('.zchip[data-z="leg-glutes"]').click();
  await p.waitForURL('**/#lift/legs/leg-glutes');
  assert.ok(await p.locator('[data-group-ex="hip-thrust"]').isVisible());
  await p.locator('#liftHead [data-act="lift-home"]').click();
  await p.waitForURL('**/#lift');
}, { noGL: true }));

test('tapping the 3D model turns 45° into a part, then picks a detailed muscle', async t => withApp(async p => {
  await p.locator('#tabseg button[data-v="lift"]').click();
  await p.waitForFunction(() => Body.ready || Body.failed, null, { timeout: 30000 });
  if (await p.evaluate(() => Body.failed)) { t.skip('WebGL2 unavailable in this browser'); return; }
  await p.evaluate(() => Body.debug.snap());
  await p.waitForTimeout(400);
  const tap = async id => {
    const pt = await p.evaluate(id => {
      const r = document.querySelector('#bCanvas').getBoundingClientRect();
      const best = [1, -1].map(s => Body.debug.zone(id, s)).map(z => Body.debug.project(z.anchor)).filter(Boolean)
        .map(q => [q, Body.debug.pickAt(q[0], q[1])]).find(([, z]) => z === ZONE[id].i);
      return best && [r.left + best[0][0], r.top + best[0][1]];
    }, id);
    assert.ok(pt, `${id} visible on the model`);
    await p.mouse.click(pt[0], pt[1]);
  };
  await tap('chest-mid');
  await p.waitForURL('**/#lift/chest');
  await p.evaluate(() => Body.debug.snap());
  await p.waitForTimeout(300);
  assert.ok(Math.abs(Math.abs(await p.evaluate(() => Body.yaw)) - Math.PI / 4) < 0.05, 'turned 45°');
  assert.equal(await p.locator('.bs-lab').count(), 3);
  await tap('chest-upper');
  await p.waitForURL('**/#lift/chest/chest-upper');
  assert.equal(await p.locator('.bs-lab[data-z="chest-upper"]').getAttribute('aria-pressed'), 'true');
}));

test('an exercise is demonstrated on the figure in a sheet, from the list and from a running session', async t => withApp(async p => {
  await p.locator('#tabseg button[data-v="lift"]').click();
  await p.locator('[data-act="lift-group"][data-g="legs"]').click();
  await p.waitForURL('**/#lift/legs');
  await p.locator('[data-act="ex-demo"][data-eid="squat"]').click();
  const sheet = p.getByRole('dialog', { name: /動作示範/ });
  await sheet.waitFor();
  assert.match(await sheet.innerText(), /股四頭肌/);
  const gl = !(await p.evaluate(() => Body.failed || document.documentElement.classList.contains('no-body3d')));
  if (gl) {
    await p.waitForFunction(() => Body.demoing?.pat === 'squat', null, { timeout: 30000 });
    assert.equal(await p.evaluate(() => document.querySelector('#bStage').parentElement.classList.contains('demo-host')), true);
  }
  // picking it from the sheet adds it to today's selection
  await sheet.locator('[data-act="demo-pick"]').click();
  assert.match(await p.locator('#liftTray').innerText(), /已選 1 個動作/);
  await sheet.locator('.sheet-x').click();
  await p.waitForFunction(() => !document.querySelector('.sheet-wrap .sheet[aria-label*="動作示範"]'));
  assert.equal(await p.evaluate(() => document.querySelector('#bStage').parentElement.id), 'liftHome');
  assert.equal(await p.evaluate(() => Body.demoing), null);
  // during a session every exercise card offers the demonstration too
  await p.locator('[data-act="group-start"]').click();
  await p.locator('#liftSession .xcard [data-act="ex-demo"]').first().click();
  await p.getByRole('dialog', { name: /動作示範/ }).waitFor();
  await p.locator('.sheet .sheet-x').click();
  assert.equal(await p.evaluate(() => document.querySelector('#bStage').parentElement.id), 'liftHome');
}));
