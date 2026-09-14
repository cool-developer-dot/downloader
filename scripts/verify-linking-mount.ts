/**
 * Linking / NavigationContainer mount-safety verifier.
 *
 * Guards against the Android React 19 warning:
 * "Can't perform a React state update on a component that hasn't mounted yet"
 * from expo-router useLinking.native.js → setLastUnhandledLink.
 *
 * Run: npm run verify:linking-mount
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

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
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

const root = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

console.log('Linking mount-safety verifier\n');

test('package.json main is custom entry.js', () => {
  const pkg = JSON.parse(read('package.json')) as { main?: string };
  assert(pkg.main === './src/entry.js', `main=${pkg.main}`);
});

test('entry.js loads gates before expo-router/entry', () => {
  const src = read('src/entry.js');
  const deferIdx = src.indexOf("import './bootstrap/defer-initial-linking'");
  const patchIdx = src.indexOf("import './bootstrap/patch-expo-router-linking'");
  const routerIdx = src.indexOf("import 'expo-router/entry'");
  assert(deferIdx >= 0, 'missing defer import');
  assert(patchIdx >= 0, 'missing expo-router linking patch');
  assert(routerIdx >= 0, 'missing expo-router entry');
  assert(deferIdx < routerIdx, 'defer must load before expo-router/entry');
  assert(patchIdx < routerIdx, 'linking patch must load before expo-router/entry');
});

test('defer-initial-linking soft-delays RN Linking under 150ms race', () => {
  const src = read('src/bootstrap/defer-initial-linking.ts');
  assert(src.includes("Platform.OS === 'android'"), 'android-only RN patch');
  assert(src.includes('Linking.getInitialURL'), 'patches getInitialURL');
  assert(src.includes('setTimeout'), 'macrotask soft delay');
  assert(
    !/\bInteractionManager\b/.test(stripComments(src)),
    'InteractionManager must not gate settlement',
  );
});

test('patch-expo-router-linking defers getInitialURL past commit', () => {
  const src = read('src/bootstrap/patch-expo-router-linking.ts');
  assert(src.includes("expo-router/build/link/linking"), 'targets linking module');
  assert(src.includes('afterNavigationContainerReady'), 'post-commit gate');
  assert(src.includes('getInitialURL'), 'wraps getInitialURL');
});

test('after-navigation-ready escapes useStore render then post-paint rAF', () => {
  const src = read('src/bootstrap/after-navigation-ready.ts');
  const code = stripComments(src);
  assert(src.includes('requestAnimationFrame'), 'rAF post-paint');
  assert(src.includes('setTimeout'), 'Hermes setTimeout after rAF');
  assert(
    !/\bInteractionManager\b/.test(code),
    'no InteractionManager',
  );
  // Macrotask first — useStore may start getInitialURL before NC exists.
  assert(
    /setTimeout\(\s*scheduleFrames\s*,\s*0\s*\)/.test(code) ||
      /setTimeout\(scheduleFrames,\s*0\)/.test(code),
    'macrotask yield before frames (early useStore race)',
  );
  // Triple rAF — concurrent React can consume a single frame pair pre-commit.
  const rafCount = (code.match(/requestAnimationFrame/g) ?? []).length;
  assert(rafCount >= 3, `expected >=3 rAF calls, got ${rafCount}`);
  assert(src.includes('useStore'), 'documents useStore early-call trigger');
  assert(src.includes('url.then'), 'documents useLinking stack frame');
});

test('BrowserScreen pendingNavigation consume is focus-effect only', () => {
  const src = read('src/browser/BrowserScreen.tsx');
  const code = stripComments(src);
  assert(code.includes('useFocusEffect'), 'useFocusEffect present');
  assert(code.includes('pendingNavigationService.consume('), 'consume present');
  const focusIdx = code.indexOf('useFocusEffect');
  const consumeIdx = code.indexOf('pendingNavigationService.consume(');
  assert(consumeIdx > focusIdx, 'consume must be inside useFocusEffect region');
  assert(
    !/useMemo\([\s\S]*pendingNavigationService\.consume/.test(code),
    'no consume in useMemo',
  );
  assert(
    !/useState\(\(\)\s*=>[\s\S]*pendingNavigationService\.consume/.test(code),
    'no consume in useState initializer',
  );
  assert(
    code.includes('targetTabId'),
    'pending consume is bound to targetTabId',
  );
});

test('+native-intent defers initial path via Promise (official API)', () => {
  const src = read('src/app/+native-intent.ts');
  const code = stripComments(src);
  assert(src.includes('export function redirectSystemPath'), 'hook present');
  assert(!/\bInteractionManager\b/.test(code), 'no InteractionManager');
  assert(code.includes('afterNavigationContainerReady'), 'post-commit gate');
  assert(/return path/.test(code), 'returns path');
});

test('root layout always renders Stack (no loading swap)', () => {
  const src = read('src/app/_layout.tsx');
  assert(src.includes('<Stack'), 'Stack present');
  assert(!/if\s*\([^)]*isReady[^)]*\)\s*\{[^}]*return/.test(src), 'no early return gating Stack');
  assert(src.includes('InitialRouteRedirect'), 'uses InitialRouteRedirect');
});

test('AppInitializer bootstrap runs in useEffect with cancel guard', () => {
  const src = read('src/hooks/use-app-initializer.ts');
  assert(src.includes('useEffect'), 'useEffect');
  assert(src.includes('runAppInitializer'), 'calls initializer');
  assert(src.includes('isMounted'), 'mounted guard');
  assert(!/runAppInitializer\(\)/.test(src.split('useEffect')[0] ?? ''), 'no render-time bootstrap');
});

test('InitialRouteRedirect navigates only in useEffect after nav key', () => {
  const src = read('src/navigation/components/InitialRouteRedirect.tsx');
  assert(src.includes('useRootNavigationState'), 'waits for root nav state');
  assert(src.includes('useEffect'), 'effect-only redirect');
  assert(!src.includes('setTimeout'), 'no setTimeout redirect hack');
  const effectBody = src.slice(src.indexOf('useEffect'));
  assert(effectBody.includes('replace('), 'replace inside effect');
});

test('route guards do not auth-gate the app stack', () => {
  const protectedSrc = read('src/navigation/guards/ProtectedRouteGuard.tsx');
  const guestSrc = read('src/navigation/guards/GuestRouteGuard.tsx');
  assert(!protectedSrc.includes('isAuthenticated'), 'no auth gate');
  assert(!protectedSrc.includes('signIn'), 'no sign-in redirect');
  assert(!protectedSrc.includes('sessionRestored'), 'no session-restored gate');
  assert(!guestSrc.includes('isAuthenticated'), 'guest guard is not auth-based');
  assert(!protectedSrc.includes('router.replace'), 'no imperative replace in Protected');
  assert(!guestSrc.includes('router.replace'), 'no imperative replace in Guest');
});

test('AppProvider always renders children (navigator mount order)', () => {
  const src = read('src/providers/app-provider.tsx');
  assert(src.includes('return <>{children}</>'), 'AppLaunchGate always renders children');
  assert(!/if\s*\(\s*!isLaunchReady/.test(src), 'no children gate on launch ready');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
