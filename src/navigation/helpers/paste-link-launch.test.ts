import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { launchDestinationFromUrl, resolvePostSplashRoute } from './resolve-post-splash-route';

describe('the "Paste link" app shortcut', () => {
  test('a cold start from the shortcut lands on the paste-link route', () => {
    assert.equal(launchDestinationFromUrl('vidorax://paste-link'), '/paste-link');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://paste-link' }), '/paste-link');
  });

  test('a first launch still sees the intro', () => {
    assert.equal(resolvePostSplashRoute({ onboardingComplete: false, launchUrl: 'vidorax://paste-link' }), '/onboarding');
  });
});
