/**
 * Central orientation controller for player fullscreen + manual orientation.
 * No control should call ScreenOrientation APIs directly.
 */

import {
  DEFAULT_ORIENTATION_MODE,
  orientationForFullscreen,
  type OrientationMode,
} from './orientation-mode';

export type OrientationLockKind = OrientationMode | 'app_default';

export type OrientationAdapter = {
  lockLandscape: () => Promise<void>;
  lockPortrait: () => Promise<void>;
  unlockAuto: () => Promise<void>;
  restoreDefault: () => Promise<void>;
};

let activeAdapter: OrientationAdapter | null = null;
let userMode: OrientationMode = DEFAULT_ORIENTATION_MODE;
let activeLock: OrientationLockKind = 'app_default';
let transitionGen = 0;

export function configureOrientationAdapter(
  adapter: OrientationAdapter | null,
): void {
  activeAdapter = adapter;
}

export function getOrientationMode(): OrientationMode {
  return userMode;
}

export function setOrientationMode(mode: OrientationMode): void {
  userMode = mode;
}

export function getOrientationLockKind(): OrientationLockKind {
  return activeLock;
}

export async function applyOrientationMode(mode: OrientationMode): Promise<void> {
  const gen = ++transitionGen;
  const adapter = activeAdapter;
  if (!adapter) {
    activeLock = mode;
    return;
  }
  try {
    switch (mode) {
      case 'auto':
        await adapter.unlockAuto();
        break;
      case 'portrait':
        await adapter.lockPortrait();
        break;
      case 'landscape':
        await adapter.lockLandscape();
        break;
    }
    if (gen === transitionGen) {
      activeLock = mode;
    }
  } catch {
    if (gen === transitionGen) {
      activeLock = mode;
    }
  }
}

export async function enterFullscreenOrientation(): Promise<void> {
  await applyOrientationMode(orientationForFullscreen(userMode));
}

export async function exitFullscreenOrientation(): Promise<void> {
  if (userMode === 'portrait') {
    await restoreAppDefaultOrientation();
    return;
  }
  await applyOrientationMode(userMode);
}

async function restoreAppDefaultOrientation(): Promise<void> {
  const gen = ++transitionGen;
  const adapter = activeAdapter;
  if (!adapter) {
    activeLock = 'app_default';
    return;
  }
  try {
    await adapter.restoreDefault();
    if (gen === transitionGen) {
      activeLock = 'app_default';
    }
  } catch {
    if (gen === transitionGen) {
      activeLock = 'app_default';
    }
  }
}

/** Alias used by lifecycle restore paths (player leave / error). */
export async function restoreOrientation(): Promise<void> {
  userMode = DEFAULT_ORIENTATION_MODE;
  await restoreAppDefaultOrientation();
}

export function resetOrientationControllerForTests(): void {
  activeAdapter = null;
  userMode = DEFAULT_ORIENTATION_MODE;
  activeLock = 'app_default';
  transitionGen = 0;
}
