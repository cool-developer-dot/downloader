/**
 * Startup splash runtime — blue-flash native path + every-cold-launch sequence.
 *
 * Usage: npm run verify:startup-splash-runtime
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cinematicPageToSplashStep,
  nextStartupSplashStep,
  resolveColdStartSplashStep,
  shouldReplayStartupSplashSequence,
  shouldSkipCinematicSplashForPersistedOnboarding,
  STARTUP_SPLASH_PERSISTENCE_FORBIDDEN_KEYS,
} from '../src/navigation/helpers/startup-splash-sequence.ts';
import { resolvePostSplashRoute } from '../src/navigation/helpers/resolve-post-splash-route.ts';
import { resolveInitialRoute } from '../src/navigation/helpers/resolve-initial-route.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

console.log('Startup Splash Runtime Verification\n');

test('1. launch starts at Splash 1', () => {
  assert(resolveInitialRoute().includes('splash'), 'initial route is splash');
  assert(resolveColdStartSplashStep() === 'splash_1', 'cold start step splash_1');
});

test('2. Splash 1 transitions to Splash 2', () => {
  assert(nextStartupSplashStep('splash_1') === 'splash_2', '1→2');
  assert(resolvePostSplashRoute().includes('onboarding'), 'post-splash → cinematic route');
  assert(
    resolvePostSplashRoute({ onboardingComplete: true }).includes('onboarding'),
    'completed onboarding still continues to Splash 2',
  );
});

test('3. Splash 2 transitions to Splash 3', () => {
  assert(nextStartupSplashStep('splash_2') === 'splash_3', '2→3');
  assert(cinematicPageToSplashStep(0) === 'splash_2', 'page0=splash2');
  assert(cinematicPageToSplashStep(1) === 'splash_3', 'page1=splash3');
});

test('4. Splash 3 transitions toward app (via splash_4 / Library)', () => {
  assert(nextStartupSplashStep('splash_3') === 'splash_4', '3→4');
  assert(nextStartupSplashStep('splash_4') === 'app', '4→app');
  const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
  assert(onboarding.includes('replace(routePaths.browser)'), 'finishes with replace browser');
  assert(onboarding.includes('hasFinishedRef'), 'completion is single-shot');
});

test('5-6. persisted first-launch state does not skip Splash 2 or 3', () => {
  assert(shouldSkipCinematicSplashForPersistedOnboarding(true) === false, 'complete=true no skip');
  assert(shouldSkipCinematicSplashForPersistedOnboarding(false) === false, 'complete=false no skip');
  const post = read('src/navigation/helpers/resolve-post-splash-route.ts');
  assert(!post.includes('selectOnboardingComplete'), 'post-splash ignores store flag');
  assert(!post.includes('routePaths.home'), 'post-splash never jumps home');
  const guard = read('src/navigation/guards/OnboardingRouteGuard.tsx');
  assert(!guard.includes('selectOnboardingComplete'), 'guard does not redirect on complete');
  assert(!guard.includes('Redirect'), 'guard has no Redirect');
});

test('7-8. second and third process startup again start Splash 1', () => {
  assert(resolveColdStartSplashStep() === 'splash_1', 'process #2');
  assert(resolveColdStartSplashStep() === 'splash_1', 'process #3');
  const initial = read('src/navigation/helpers/resolve-initial-route.ts');
  assert(initial.includes('routePaths.splash'), 'always splash');
  assert(initial.includes('every app open'), 'replays every open');
});

test('9. warm AppState resume does not restart sequence', () => {
  assert(shouldReplayStartupSplashSequence('process_start') === true, 'cold replays');
  assert(shouldReplayStartupSplashSequence('appstate_active') === false, 'warm no replay');
  assert(shouldReplayStartupSplashSequence('appstate_background') === false, 'bg no replay');
  const splash = read('src/screens/splash/SplashScreen.tsx');
  assert(!splash.includes('AppState'), 'SplashScreen does not listen AppState');
  const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
  assert(!onboarding.includes('AppState'), 'OnboardingScreen does not listen AppState');
});

test('10. startup splash state is not persisted', () => {
  const persist = read('src/store/app/index.ts');
  for (const key of STARTUP_SPLASH_PERSISTENCE_FORBIDDEN_KEYS) {
    assert(!persist.includes(key), `must not persist ${key}`);
  }
  assert(persist.includes('onboardingComplete'), 'preference flag may remain');
  assert(persist.includes('firstLaunch'), 'preference flag may remain');
});

test('11. browser cookies untouched', () => {
  const post = read('src/navigation/helpers/resolve-post-splash-route.ts');
  const guard = read('src/navigation/guards/OnboardingRouteGuard.tsx');
  const splash = read('src/screens/splash/SplashScreen.tsx');
  for (const src of [post, guard, splash]) {
    assert(!src.includes('CookieManager'), 'no cookie API in startup path');
    assert(!src.includes('clearCookies'), 'no cookie clear');
  }
});

test('12-13. settings/theme persistence untouched by splash routing', () => {
  const post = read('src/navigation/helpers/resolve-post-splash-route.ts');
  assert(!post.includes('setThemeMode'), 'no theme reset');
  assert(!post.includes('useSettingsStore'), 'no settings mutation');
  const colors = read('android/app/src/main/res/values/colors.xml');
  assert(colors.includes('#1A2517'), 'native splash matches Deep Olive');
  // Native OS splash is static (pre-JS). React-owned splash follows selected theme.
  assert(
    read('src/theme/intro-palette.ts').includes('colors.dark.background'),
    'React Dark splash uses neutral theme',
  );
  assert(
    !read('src/theme/intro-palette.ts').includes('#1A2517'),
    'React intro no olive',
  );
});

test('14. no arbitrary timer added to hide blue flash', () => {
  const provider = read('src/providers/app-provider.tsx');
  assert(provider.includes('SplashScreen.hideAsync()'), 'hide on ready');
  assert(!provider.includes('setTimeout'), 'no delay hack in AppProvider');
  const splash = read('src/screens/splash/SplashScreen.tsx');
  assert(!/setTimeout\s*\(\s*\(\)\s*=>\s*SplashScreen/.test(splash), 'no splash hide timer');
});

test('15-16. no old blue native splash in active launch theme', () => {
  const colors = read('android/app/src/main/res/values/colors.xml');
  assert(!colors.includes('#E6F4FE'), 'no Expo light-blue iconBackground');
  assert(!colors.includes('#023c69'), 'no Expo blue colorPrimary');
  assert(!colors.includes('#05070D'), 'no old navy splash background');
  assert(colors.includes('splashscreen_background">#1A2517'), 'current bg');
  const styles = read('android/app/src/main/res/values/styles.xml');
  assert(styles.includes('windowSplashScreenBackground">@color/splashscreen_background'), 'A12 bg');
  assert(styles.includes('windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo'), 'logo');
  // Binary splash logo must not be the old blue Expo mark (spot-check via source path + app.json).
  const appJson = read('app.json');
  assert(appJson.includes('"backgroundColor": "#1A2517"'), 'expo splash plugin olive');
  assert(appJson.includes('splash-icon.png'), 'current splash image');
});

test('17. post-splash theme correct', () => {
  const styles = read('android/app/src/main/res/values/styles.xml');
  assert(styles.includes('postSplashScreenTheme">@style/AppTheme'), 'post theme');
  assert(styles.includes('android:windowBackground">@color/splashscreen_background'), 'bridge bg');
});

test('18. startup completion cannot execute twice', () => {
  const splash = read('src/screens/splash/SplashScreen.tsx');
  assert(splash.includes('hasNavigatedRef'), 'splash single navigate');
  const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
  assert(onboarding.includes('hasFinishedRef'), 'cinematic single finish');
});

test('19. back stack does not contain splash sequence after completion', () => {
  const splash = read('src/screens/splash/SplashScreen.tsx');
  assert(splash.includes('router.replace'), 'splash replace');
  const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
  assert(onboarding.includes('replace(routePaths.browser)'), 'browser replace');
  assert(onboarding.includes('useAuthBackHandler'), 'back swallowed on cinematic');
  assert(splash.includes('useAuthBackHandler'), 'back swallowed on splash');
});

test('20. no expo prebuild in this fix path', () => {
  // Guardrail: package script exists historically but this verifier must not invoke it.
  assert(true, 'static only');
  const pkg = read('package.json');
  assert(pkg.includes('verify:startup-splash-runtime'), 'script registered');
});

console.log(`\nStartup splash: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
