import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolvePostSplashRoute } from './resolve-post-splash-route';
import { shouldSkipCinematicSplashForPersistedOnboarding } from './startup-splash-sequence';

describe('after the branded splash', () => {
  test('a first launch sees the intro', () => {
    assert.equal(resolvePostSplashRoute({ onboardingComplete: false }), '/onboarding');
    assert.equal(resolvePostSplashRoute(), '/onboarding');
  });

  test('a returning user goes straight to Browser', () => {
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true }), '/browser');
    assert.equal(shouldSkipCinematicSplashForPersistedOnboarding(true), true);
    assert.equal(shouldSkipCinematicSplashForPersistedOnboarding(false), false);
  });
});

describe('a cold start from a download notification', () => {
  test('lands on the screen the notification points at, not on Browser', () => {
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://library' }), '/library');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://downloads' }), '/downloads');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax:///downloads/?from=n' }), '/downloads');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: '/library' }), '/library');
  });

  test('anything else starts on Browser; a first launch still sees the intro', () => {
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: null }), '/browser');
    assert.equal(
      resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'https://videos.example/watch/1' }),
      '/browser',
      'a web link opens in a tab, which the browser does itself',
    );
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://settings/app-lock' }), '/browser');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: true, launchUrl: 'vidorax://player/abc' }), '/browser');
    assert.equal(resolvePostSplashRoute({ onboardingComplete: false, launchUrl: 'vidorax://library' }), '/onboarding');
  });
});
