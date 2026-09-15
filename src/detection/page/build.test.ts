import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { parse } from 'acorn';

import { BUILD_SCRIPT, detectorScript } from './test-harness.ts';

test('the detector parses as an ES2017 script, so it runs on old Android System WebViews', () => {
  assert.doesNotThrow(() => parse(detectorScript(), { ecmaVersion: 2017, sourceType: 'script' }));
});

test('the build is deterministic', () => {
  assert.equal(execFileSync(process.execPath, [BUILD_SCRIPT, '--stdout'], { encoding: 'utf8' }), detectorScript());
});

test('detector.generated.ts matches the sources', () => {
  assert.doesNotThrow(
    () => execFileSync(process.execPath, [BUILD_SCRIPT, '--check'], { stdio: 'pipe' }),
    'run `npm run build:detector` after editing src/detection/page/src',
  );
});
