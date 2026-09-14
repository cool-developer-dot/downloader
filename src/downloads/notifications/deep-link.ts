/**
 * Pending notification deep-link target — survives bootstrap until navigation ready.
 */

import { downloadDetailsPath, routePaths } from '@/navigation/constants/route-paths';

export type PendingNotificationTarget = {
  downloadId: string;
  capturedAt: number;
};

let pending: PendingNotificationTarget | null = null;
let navigationReady = false;
let authReadyProbe: (() => boolean) | null = null;
let existsProbe: ((downloadId: string) => boolean | Promise<boolean>) | null =
  null;

type NavigateFn = (target: string) => boolean;

function navigate(target: string): boolean {
  try {
    // Lazy — avoid loading expo-router in Node verify scripts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeNavigate } = require('@/navigation/helpers/safe-navigation') as {
      safeNavigate: NavigateFn;
    };
    return safeNavigate(target);
  } catch {
    return false;
  }
}

export function setNotificationNavigationReady(ready: boolean): void {
  navigationReady = ready;
  if (ready) {
    void flushPendingNotificationTarget();
  }
}

export function setNotificationAuthProbe(probe: () => boolean): void {
  authReadyProbe = probe;
}

export function setNotificationExistsProbe(
  probe: (downloadId: string) => boolean | Promise<boolean>,
): void {
  existsProbe = probe;
}

export function capturePendingNotificationTarget(downloadId: string): void {
  if (!isValidDownloadId(downloadId)) {
    return;
  }
  pending = { downloadId, capturedAt: Date.now() };
}

export function getPendingNotificationTarget(): PendingNotificationTarget | null {
  return pending;
}

export function clearPendingNotificationTarget(): void {
  pending = null;
}

export function isValidDownloadId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  const trimmed = id.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    return false;
  }
  if (trimmed.includes('/') || trimmed.includes('://') || trimmed.includes('?')) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Route to Download Details when navigation is ready.
 * Missing download → Downloads fallback.
 */
export async function resolveNotificationNavigation(
  downloadId: string,
): Promise<'details' | 'downloads' | 'deferred' | 'ignored'> {
  if (!isValidDownloadId(downloadId)) {
    if (navigationReady) {
      navigate(routePaths.downloads);
      return 'downloads';
    }
    return 'ignored';
  }

  if (!navigationReady) {
    capturePendingNotificationTarget(downloadId);
    return 'deferred';
  }

  // Optional auth readiness gate (set by app shell when relevant).
  if (authReadyProbe && !authReadyProbe()) {
    capturePendingNotificationTarget(downloadId);
    return 'ignored';
  }

  if (existsProbe) {
    try {
      const exists = await Promise.resolve(existsProbe(downloadId));
      if (!exists) {
        clearPendingNotificationTarget();
        navigate(routePaths.downloads);
        return 'downloads';
      }
    } catch {
      clearPendingNotificationTarget();
      navigate(routePaths.downloads);
      return 'downloads';
    }
  }

  clearPendingNotificationTarget();
  navigate(downloadDetailsPath(downloadId));
  return 'details';
}

export async function flushPendingNotificationTarget(): Promise<void> {
  if (!pending || !navigationReady) {
    return;
  }
  const id = pending.downloadId;
  pending = null;
  await resolveNotificationNavigation(id);
}

/** Test reset. */
export function resetNotificationDeepLinkForTests(): void {
  pending = null;
  navigationReady = false;
  authReadyProbe = null;
  existsProbe = null;
}
