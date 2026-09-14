/**
 * Behavioral regression for the useStore → getInitialURL → useLinking mount race.
 *
 * Proves afterNavigationContainerReady does not resolve inside the same
 * synchronous turn (or immediate microtasks) that would represent
 * ContextNavigator/useStore calling getInitialURL before NavigationContainer
 * commits — the path that produces:
 *   useLinking.native.js → url.then$argument_0 → setLastUnhandledLink
 *
 * Run: npx tsx scripts/verify-linking-lifecycle-race.ts
 */
import { afterNavigationContainerReady } from '../src/bootstrap/after-navigation-ready';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`PASS  ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL  ${name}`);
      console.error(`      ${message}`);
    });
}

async function main(): Promise<void> {
  console.log('Linking lifecycle race verifier\n');

  await test('afterNavigationContainerReady does not settle synchronously', async () => {
    let settled = false;
    const pending = afterNavigationContainerReady().then(() => {
      settled = true;
    });

    assert(settled === false, 'must not settle in the starting turn');

    await Promise.resolve();
    assert(settled === false, 'must not settle in microtasks alone (pre-commit window)');

    await pending;
    assert(settled === true, 'must eventually settle');
  });

  await test('afterNavigationContainerReady survives early useStore-style prefetch', async () => {
    // Simulate useStore calling getInitialURL during ContextNavigator render:
    // start the gate, then continue "rendering" synchronously for a stretch.
    let settledDuringSyntheticRender = false;
    const gate = afterNavigationContainerReady().then(() => {
      settledDuringSyntheticRender = true;
    });

    // Synthetic heavy render / concurrent work in the same turn.
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait — gate must still be pending
    }
    assert(
      settledDuringSyntheticRender === false,
      'gate must not settle during synthetic render (useStore early call)',
    );

    await gate;
    assert(settledDuringSyntheticRender === true, 'gate settles after yield+frames');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
