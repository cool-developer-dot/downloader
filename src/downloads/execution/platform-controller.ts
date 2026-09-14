import type { BackgroundExecutionController } from './background-execution-controller';
import { createNoopBackgroundExecutionController } from './noop-controller';

let cached: BackgroundExecutionController | null = null;

function isAndroidRuntime(): boolean {
  try {
    // Lazy — avoid loading react-native in Node verify scripts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS === 'android';
  } catch {
    return false;
  }
}

/**
 * Platform factory — Android uses native FGS bridge; others no-op.
 */
export function getBackgroundExecutionController(): BackgroundExecutionController {
  if (cached) {
    return cached;
  }
  if (isAndroidRuntime()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAndroidBackgroundExecutionController } = require('./android-controller') as {
      createAndroidBackgroundExecutionController: () => BackgroundExecutionController;
    };
    cached = createAndroidBackgroundExecutionController();
  } else {
    cached = createNoopBackgroundExecutionController();
  }
  return cached;
}

/** Test / injection hook. */
export function setBackgroundExecutionControllerForTests(
  controller: BackgroundExecutionController | null,
): void {
  cached = controller;
}
