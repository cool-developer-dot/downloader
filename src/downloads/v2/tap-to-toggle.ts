/**
 * Tap to Toggle (#335): with the setting on, tapping a running download's row pauses it and tapping a paused one
 * resumes it — exactly the Pause / Resume button the row already shows. Anything else (setting off, a v1 row, a
 * queued, finishing, finished or failed row, a row without that button) keeps today's tap: open the details.
 */

import type { DownloadStatus } from '@/api/types';

export type TapToggleInput = {
  enabled: boolean;
  engineOwned: boolean;
  status: DownloadStatus | null | undefined;
  /** The row's own card actions (`getSupportedActions`), so a tap never does what the row does not offer. */
  cardActions: readonly string[];
};

export type TapToggleAction = 'pause' | 'resume';

/** Pure. Null means "open the details as before". */
export function resolveTapToggle(input: TapToggleInput): TapToggleAction | null {
  if (!input.enabled || !input.engineOwned) {
    return null;
  }
  if (input.status === 'DOWNLOADING' && input.cardActions.includes('pause')) {
    return 'pause';
  }
  if (input.status === 'PAUSED' && input.cardActions.includes('resume')) {
    return 'resume';
  }
  return null;
}
