'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('app startup does not scan miIO devices without their paired tokens', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  assert.doesNotMatch(appSource, /miio\.browse\s*\(/);
});
