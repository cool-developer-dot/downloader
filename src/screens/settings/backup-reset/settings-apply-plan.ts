import type { DownloadSettings } from '@/downloads/settings/types';
import type { SettingsKey } from '@/store/settings/types';

/**
 * Settings that have a second saved copy, the download policy (`@/downloads/settings`), which is read back when the
 * app starts and wins over the settings store. Writing only the store left them unchanged after a restart (and the
 * screen showing the policy's value), so they go through the policy, which updates the store too.
 */
export const POLICY_KEYS: Partial<Record<SettingsKey, keyof DownloadSettings>> = {
  wifiOnly: 'wifiOnly',
  autoResume: 'autoResume',
  notifications: 'notificationsEnabled',
  maxConcurrentDownloads: 'maxConcurrentDownloads',
};

/** Pure: which values go through the download policy (as one patch) and which straight to the settings store. */
export function planSettingsChanges(values: readonly (readonly [SettingsKey, unknown])[]): {
  policy: Partial<DownloadSettings>;
  store: [SettingsKey, unknown][];
} {
  const policy: Record<string, unknown> = {};
  const store: [SettingsKey, unknown][] = [];
  for (const [key, value] of values) {
    const policyKey = POLICY_KEYS[key];
    if (policyKey) {
      policy[policyKey] = value;
    } else {
      store.push([key, value]);
    }
  }
  return { policy: policy as Partial<DownloadSettings>, store };
}
