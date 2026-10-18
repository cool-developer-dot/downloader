/**
 * Save cover image (#371): when "Save thumbnail" is offered. Pure.
 *
 * - Only a finished v2 video with a local thumbnail file (the library's own WebP, a `file://` URI) — never a page's
 *   remote poster.
 * - Only when the installed native build can do it (`saveThumbnailToGallery`).
 * - Android 10+ needs no permission. Android 9 and older need WRITE_EXTERNAL_STORAGE, which the app manifest
 *   declares (maxSdkVersion 28); without that declaration the action would be hidden there.
 */

import type { DownloadStatus } from '@/api/types';

/** `android/app/src/main/AndroidManifest.xml` declares WRITE_EXTERNAL_STORAGE with maxSdkVersion 28. */
export const LEGACY_STORAGE_PERMISSION_DECLARED = true;
const ANDROID_10 = 29;

export type ThumbnailSaveInput = {
  engineOwned: boolean;
  status: DownloadStatus | null | undefined;
  thumbnailUrl: string | null | undefined;
  nativeAvailable: boolean;
  /** `Platform.Version` on Android. */
  sdkInt: number;
  legacyPermissionDeclared?: boolean;
};

export function hasLocalThumbnail(thumbnailUrl: string | null | undefined): boolean {
  return typeof thumbnailUrl === 'string' && /^file:\/\/\/?./i.test(thumbnailUrl.trim());
}

export function canSaveThumbnail(input: ThumbnailSaveInput): boolean {
  if (!input.nativeAvailable || !input.engineOwned || input.status !== 'COMPLETED') {
    return false;
  }
  if (!hasLocalThumbnail(input.thumbnailUrl)) {
    return false;
  }
  if (Number.isFinite(input.sdkInt) && input.sdkInt < ANDROID_10) {
    return input.legacyPermissionDeclared ?? LEGACY_STORAGE_PERMISSION_DECLARED;
  }
  return true;
}

/** Pure: the sheet's actions with `extra` placed before the one with `beforeId` (or last), or unchanged without it. */
export function insertActionBefore<T extends { id: string }>(actions: readonly T[], extra: T | null, beforeId: string): T[] {
  if (!extra) {
    return actions as T[];
  }
  const index = actions.findIndex((action) => action.id === beforeId);
  if (index < 0) {
    return [...actions, extra];
  }
  return [...actions.slice(0, index), extra, ...actions.slice(index)];
}

export type ThumbnailSaveOutcome = 'saved' | 'permission' | 'missing' | 'failed';

/** Pure: the outcome of the native call's error. */
export function thumbnailSaveFailure(error: unknown): ThumbnailSaveOutcome {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ERR_STORAGE_PERMISSION') {
    return 'permission';
  }
  if (code === 'ERR_NOT_FOUND') {
    return 'missing';
  }
  return 'failed';
}

/** Pure: runs `task` for an id unless one is already running for it (a quick second tap saves nothing twice). */
export function createInFlightGuard() {
  const running = new Set<string>();
  return async (id: string, task: () => Promise<void>): Promise<boolean> => {
    if (running.has(id)) {
      return false;
    }
    running.add(id);
    try {
      await task();
      return true;
    } finally {
      running.delete(id);
    }
  };
}
