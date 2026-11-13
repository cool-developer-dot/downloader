import { useEffect, useState } from 'react';
import * as Font from 'expo-font';

/**
 * B15 #172 (reused by B16 #272) — the bundled Noto Nastaliq Urdu font (assets/fonts, SIL Open Font License 1.1; the
 * licence text is next to it). Loaded only when Urdu text is first shown (it is about 690 KB), once per app run.
 *
 * - The reader draws Urdu articles with it as an app font (`NASTALIQ_FONT_FAMILY`).
 * - B16's page font (#272) tries the phone's own Nastaliq first; the same asset file would serve pages once the
 *   WebView can load it from the app (see the B16 notes).
 */

export const NASTALIQ_FONT_FAMILY = 'NotoNastaliqUrdu';

export const NASTALIQ_FONT_ASSET = require('../../../assets/fonts/NotoNastaliqUrdu-Regular.ttf');

let loading: Promise<boolean> | null = null;

/** Loads the font once; true when it can be used. A failure is not cached (the next call tries again). */
export function loadNastaliqFont(): Promise<boolean> {
  try {
    if (Font.isLoaded(NASTALIQ_FONT_FAMILY)) return Promise.resolve(true);
  } catch {
    // isLoaded is missing on very old builds: load below.
  }
  if (!loading) {
    loading = Font.loadAsync({ [NASTALIQ_FONT_FAMILY]: NASTALIQ_FONT_ASSET })
      .then(() => true)
      .catch(() => {
        loading = null;
        return false;
      });
  }
  return loading;
}

/** Whether the Nastaliq font is ready; starts loading it when `wanted`. */
export function useNastaliqFont(wanted: boolean): boolean {
  const [ready, setReady] = useState(() => {
    try {
      return Font.isLoaded(NASTALIQ_FONT_FAMILY);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!wanted || ready) return;
    let cancelled = false;
    void loadNastaliqFont().then((ok) => {
      if (!cancelled && ok) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, wanted]);
  return ready;
}
