import { useSettingsStore } from '@/store/settings';

import { setFilenameTemplateSource } from './filename-naming';

let attached = false;

/** Lets the download handoff read the user's filename template (Download Settings → File naming). Idempotent. */
export function ensureFilenameNaming(): void {
  if (attached) {
    return;
  }
  attached = true;
  setFilenameTemplateSource(() => useSettingsStore.getState().filenameTemplate);
}
