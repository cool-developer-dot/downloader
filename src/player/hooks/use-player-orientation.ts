import { useCallback, useEffect, useState } from 'react';

import {
  applyOrientationMode,
  setOrientationMode as persistOrientationMode,
} from '@/player/orientation-controller';
import { getDefaultOrientation } from '@/player/orientation-default-preference';
import type { OrientationMode } from '@/player/orientation-mode';
import { ensurePlayerChromeRuntime } from '@/player/player-chrome.runtime';

export type UsePlayerOrientationResult = {
  mode: OrientationMode;
  setMode: (mode: OrientationMode) => void;
};

/**
 * Session-local orientation preference for the player screen.
 */
export function usePlayerOrientation(): UsePlayerOrientationResult {
  // Design 25: each video opens in the default orientation from Player settings (Auto unless changed).
  const [mode, setModeState] = useState<OrientationMode>(() => getDefaultOrientation());

  useEffect(() => {
    ensurePlayerChromeRuntime();
    persistOrientationMode(mode);
    void applyOrientationMode(mode);
  }, [mode]);

  const setMode = useCallback((next: OrientationMode) => {
    setModeState(next);
    persistOrientationMode(next);
    void applyOrientationMode(next);
  }, []);

  return { mode, setMode };
}
