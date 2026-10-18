import { useSettingsStore } from '@/store/settings';

import { getNotificationTogglePort, pushNotificationToggle } from './notification-toggle';

let detach: (() => void) | null = null;

/** Idempotent: pushes "Download notifications" to the native runner now and whenever it changes. */
export function ensureV2NotificationToggle(): void {
  if (detach) {
    return;
  }
  const port = getNotificationTogglePort();
  if (!port) {
    return;
  }
  const push = () => {
    void pushNotificationToggle(port, useSettingsStore.getState().notifications !== false);
  };
  push();
  detach = useSettingsStore.subscribe(push);
}
