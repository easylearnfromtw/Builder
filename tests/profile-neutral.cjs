'use strict';

// Run: node tests/profile-neutral.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

assert.match(html, /<title>健人｜訓練日誌<\/title>/);
assert.match(html, /id="brandName">我的訓練日誌<\/b>/);
assert.equal(manifest.name, '健人｜訓練日誌');
assert.match(html, /S\.profile\.name = t\.value\.trim\(\); S\.profile\.nameCustomized = true;/);
assert.match(html, /restored\.profile\.name !== raw\.profile\?\.name/);

const start = html.indexOf('function freshState() {');
const end = html.indexOf('/* New installations', start);
assert.ok(start >= 0 && end > start, 'Could not locate state initialization functions');

const context = vm.createContext({
  DEFAULT_EX: [],
  DEFAULT_TPL: Array.from({ length: 5 }, (_, i) => ({ id: String(i), ex: [] })),
});
vm.runInContext(html.slice(start, end) + '\nthis.fresh = freshState; this.norm = normalize;', context);

assert.equal(context.fresh().profile.name, '', 'New visitor must not receive another person\'s name');
assert.equal(context.fresh().profile.nameCustomized, false);
const workout = { date: '2026-10-20', items: [] };
const previous = context.norm({
  profile: { name: '林哲愷' },
  lifts: [workout],
  runs: [],
});
assert.equal(previous.profile.name, '', 'Old auto-filled name should be cleared');
assert.equal(previous.lifts.length, 1, 'Workouts must not be erased by profile migration');

const custom = context.norm({ profile: { name: '林哲愷', nameCustomized: true }, lifts: [], runs: [] });
assert.equal(custom.profile.name, '林哲愷', 'Explicitly chosen names should be preserved');

const other = context.norm({ profile: { name: '另一位使用者' }, lifts: [], runs: [] });
assert.equal(other.profile.name, '另一位使用者', 'Other existing names should be preserved');

console.log('Profile defaults and legacy-name migration passed.');
