import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { defaultTabRoute, normalizeDefaultTab, routeForDefaultTab, setDefaultTabSource } from './default-tab';
import { resolvePostSplashRoute } from './resolve-post-splash-route';

afterEach(() => setDefaultTabSource(null));

describe('default tab', () => {
  test('Browser unless chosen otherwise', () => {
    assert.equal(defaultTabRoute(), '/browser');
    setDefaultTabSource(() => 'downloads');
    assert.equal(defaultTabRoute(), '/downloads');
    setDefaultTabSource(() => 'player');
    assert.equal(defaultTabRoute(), '/library');
  });

  test('unknown or failing sources fall back to Browser', () => {
    setDefaultTabSource(() => 'settings');
    assert.equal(defaultTabRoute(), '/browser');
    setDefaultTabSource(() => {
      throw new Error('not hydrated');
    });
    assert.equal(defaultTabRoute(), '/browser');
    assert.equal(normalizeDefaultTab(undefined), 'browser');
    assert.equal(routeForDefaultTab('browser'), '/browser');
  });

  test('the splash uses it only as the last fallback', () => {
    setDefaultTabSource(() => 'downloads');
    // A returning user with no link lands on the chosen tab.
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true }), '/downloads');
    // First launch: onboarding is unchanged.
    assert.equal(resolvePostSplashRoute({ onboardingComplete: false }), '/onboarding');
    // A notification's link still decides.
    setDefaultTabSource(() => 'player');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://downloads' }), '/downloads');
    setDefaultTabSource(() => 'downloads');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://library' }), '/library');
  });
});
