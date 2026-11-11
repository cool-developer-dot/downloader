import { useSettingsStore } from '@/store/settings';

import { setFileExtensionSource, setFilenameTemplateSource } from './filename-naming';

let attached = false;

/** Lets the download handoff read the filename template and extension (Download Settings → File naming). Idempotent. */
export function ensureFilenameNaming(): void {
  if (attached) {
    return;
  }
  attached = true;
  setFilenameTemplateSource(() => useSettingsStore.getState().filenameTemplate);
  setFileExtensionSource(() => useSettingsStore.getState().fileExtension);
}
