import { useEffect } from 'react';

import { ensureTabSleep } from '@/browser/tab-sound/tab-sleep.service';

/** B3 #15: while the browser is mounted, unused tabs go to sleep (when the setting is on). */
export function useTabSleep(): void {
  useEffect(() => ensureTabSleep(), []);
}
