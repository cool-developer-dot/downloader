import { useEffect, useSyncExternalStore } from 'react';
import * as Brightness from 'expo-brightness';

import { isBrowserRouteVisible, subscribeBrowserRouteVisible } from '@/browser/webview/webview-activity';
import { useSettingsStore } from '@/store/settings';

import { BRIGHTNESS_SYSTEM, normalizePageBrightness } from './page-display-settings';

type Saved = { system: boolean; value: number };

let chain: Promise<void> = Promise.resolve();
function queue(step: () => Promise<void>): void {
  chain = chain.then(step, step);
}

async function restore(saved: Saved | null): Promise<void> {
  if (!saved) return;
  try {
    if (saved.system) await Brightness.restoreSystemBrightnessAsync();
    else await Brightness.setBrightnessAsync(saved.value);
  } catch {
    // ignore
  }
}

/**
 * B16 #181 — the browser's own brightness: the app window's only (expo-brightness `setBrightnessAsync`, no
 * permission; the phone's setting is never changed). Applied while the browser is in front; leaving the browser (another
 * part of the app) or the setting back to "Phone brightness" puts the window back as it was.
 */
export function usePageBrightness(): void {
  const level = normalizePageBrightness(useSettingsStore((s) => s.pageBrightness));
  const visible = useSyncExternalStore(subscribeBrowserRouteVisible, isBrowserRouteVisible);

  useEffect(() => {
    if (level === BRIGHTNESS_SYSTEM || !visible) return undefined;
    let saved: Saved | null = null;
    // Applying and restoring run one after another, so a quick change never leaves the window at the wrong level.
    queue(async () => {
      try {
        const system = await Brightness.isUsingSystemBrightnessAsync();
        const value = await Brightness.getBrightnessAsync();
        saved = { system, value };
        await Brightness.setBrightnessAsync(level / 100);
      } catch {
        // No window to change (e.g. the activity is gone): nothing to restore either.
      }
    });
    return () => {
      queue(() => restore(saved));
    };
  }, [level, visible]);
}
