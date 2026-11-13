import { useSettingsStore } from '@/store/settings';

import { setDefaultTabSource } from './default-tab';

let attached = false;

/** Lets the splash read Settings → Default tab. Idempotent. */
export function ensureDefaultTab(): void {
  if (attached) {
    return;
  }
  attached = true;
  setDefaultTabSource(() => useSettingsStore.getState().defaultTab);
}
