import { updateDownloadSettings } from '@/downloads/settings';
import { useSettingsStore, type SettingsKey } from '@/store/settings';

import { planSettingsChanges } from './settings-apply-plan';

export { resetDownloaderStores } from './downloader-stores-reset';

/** Writes `values` as a manual change would: the policy-backed ones through the policy, the rest through the store. */
export function applySettings(values: readonly (readonly [SettingsKey, unknown])[]): void {
  const { policy, store } = planSettingsChanges(values);
  const settings = useSettingsStore.getState();
  for (const [key, value] of store) {
    settings.updateSetting(key, value as never);
  }
  if (Object.keys(policy).length > 0) {
    updateDownloadSettings(policy);
  }
}
