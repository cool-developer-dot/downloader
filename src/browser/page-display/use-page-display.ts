import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type WebView from 'react-native-webview';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { useTheme } from '@/hooks/use-theme';
import { useSettingsStore } from '@/store/settings';
import { selectThemeMode, useThemeStore } from '@/store/theme';
import { normalizeThemePreference, resolveThemeMode } from '@/theme/theme-preference';

import { displayMatrix } from './page-display-filters';
import { createPageDisplayNative } from './page-display-native';
import { pageDisplayScript } from './page-display-script';
import {
  DEFAULT_TEXT_ZOOM,
  normalizeColorFilter,
  normalizeForceDark,
  normalizeNightLightStrength,
  normalizePageFontStyle,
  normalizeTextZoom,
  parseSiteDisplays,
  resolvePageDisplay,
  type PageDisplay,
  type PageDisplayGlobals,
  type SiteDisplayMap,
} from './page-display-settings';

export const pageDisplayNative = createPageDisplayNative(() => (isVidoraWebAvailable() ? getVidoraWeb() : null));

let sitesCache: { raw: unknown; map: SiteDisplayMap } = { raw: undefined, map: {} };

/** The Page display globals and per-site list as stored now (read at call time, never from a render). */
function storedDisplayInputs(): { globals: PageDisplayGlobals; sites: SiteDisplayMap; appDark: boolean } {
  const s = useSettingsStore.getState();
  if (sitesCache.raw !== s.pageDisplaySites) sitesCache = { raw: s.pageDisplaySites, map: parseSiteDisplays(s.pageDisplaySites) };
  let appDark = false;
  try {
    appDark = resolveThemeMode(normalizeThemePreference(selectThemeMode(useThemeStore.getState()))) === 'dark';
  } catch {
    appDark = false;
  }
  return {
    globals: {
      forceDark: normalizeForceDark(s.pageForceDark),
      textZoom: normalizeTextZoom(s.pageTextZoom),
      forceZoom: s.pageForceZoom === true,
      textReflow: s.pageTextReflow === true,
      fontStyle: normalizePageFontStyle(s.pageFontStyle),
      urduNastaliq: s.pageUrduNastaliq !== false,
      colorFilter: normalizeColorFilter(s.pageColorFilter),
      nightLight: s.pageNightLight === true,
      nightLightStrength: normalizeNightLightStrength(s.pageNightLightStrength),
    },
    sites: sitesCache.map,
    appDark,
  };
}

/**
 * B16 — sends the native layout and colour matrix for the page at `url` to the WebView `viewTag`. Resolved from the
 * stores at call time, so a page that starts loading on another site gets that site's values at once (not the
 * previous page's).
 */
export function applyPageDisplayNative(viewTag: number | null, url: string): void {
  if (viewTag == null) return;
  const { globals, sites, appDark } = storedDisplayInputs();
  const display = resolvePageDisplay(globals, sites, url, appDark);
  pageDisplayNative.applyLayout(viewTag, {
    textReflow: display.textReflow,
    initialScale: display.initialScale,
    darkening: display.forceDark,
  });
  pageDisplayNative.applyFilter(viewTag, displayMatrix(display.colorFilter, display.nightLight, display.nightLightStrength));
}

/** The global Page display settings with the per-site list, resolved for `url`. */
export function usePageDisplayFor(url: string): PageDisplay {
  const theme = useTheme();
  const forceDark = normalizeForceDark(useSettingsStore((s) => s.pageForceDark));
  const textZoom = normalizeTextZoom(useSettingsStore((s) => s.pageTextZoom));
  const forceZoom = useSettingsStore((s) => s.pageForceZoom === true);
  const textReflow = useSettingsStore((s) => s.pageTextReflow === true);
  const fontStyle = normalizePageFontStyle(useSettingsStore((s) => s.pageFontStyle));
  const urduNastaliq = useSettingsStore((s) => s.pageUrduNastaliq !== false);
  const colorFilter = normalizeColorFilter(useSettingsStore((s) => s.pageColorFilter));
  const nightLight = useSettingsStore((s) => s.pageNightLight === true);
  const nightLightStrength = normalizeNightLightStrength(useSettingsStore((s) => s.pageNightLightStrength));
  const sitesRaw = useSettingsStore((s) => s.pageDisplaySites);
  const sites = useMemo(() => parseSiteDisplays(sitesRaw), [sitesRaw]);
  return useMemo(
    () =>
      resolvePageDisplay(
        { forceDark, textZoom, forceZoom, textReflow, fontStyle, urduNastaliq, colorFilter, nightLight, nightLightStrength },
        sites,
        url,
        theme.mode === 'dark',
      ),
    [colorFilter, fontStyle, forceDark, forceZoom, nightLight, nightLightStrength, sites, textReflow, textZoom, theme.mode, url, urduNastaliq],
  );
}

/**
 * B16 — Page display for one tab's WebView: the `textZoom` / `forceDarkOn` props (left unset until a setting first
 * differs from the default, so nothing changes for people who never touch them), the document-start script, the
 * script again when a choice changes (the page in front updates at once), and the native layout / colour matrix again
 * when a setting changes. The WebView calls `applyPageDisplayNative(tag, url)` whenever a page starts loading.
 */
export function usePageDisplay({
  tabId,
  url,
  webViewRef,
}: {
  tabId: string | undefined;
  url: string;
  webViewRef: RefObject<WebView | null>;
}) {
  const display = usePageDisplayFor(url);
  // Once set, the props stay set: removing them would hand react-native-webview its "unset" values (textZoom 0),
  // not WebView's defaults (which follow the phone's font size).
  const [touched, setTouched] = useState({ zoom: false, dark: false });
  const zoomChanged = display.textZoom !== DEFAULT_TEXT_ZOOM;
  if ((zoomChanged && !touched.zoom) || (display.forceDark && !touched.dark)) {
    setTouched({ zoom: touched.zoom || zoomChanged, dark: touched.dark || display.forceDark });
  }

  const scriptOptions = useMemo(
    () => ({ fontStyle: display.fontStyle, urduNastaliq: display.urduNastaliq, forceZoom: display.forceZoom }),
    [display.fontStyle, display.forceZoom, display.urduNastaliq],
  );
  const script = useMemo(() => pageDisplayScript(scriptOptions), [scriptOptions]);

  // A changed choice reaches the page already shown (new pages get it at document start).
  const shownScript = useRef(script);
  useEffect(() => {
    if (shownScript.current === script) return;
    shownScript.current = script;
    try {
      webViewRef.current?.injectJavaScript(script);
    } catch {
      // ignore
    }
  }, [script, webViewRef]);

  // A changed setting reaches the page already shown (a new page gets its values when it starts loading).
  useEffect(() => {
    if (tabId) applyPageDisplayNative(getTabWebViewTag(tabId), url);
  }, [
    display.colorFilter,
    display.forceDark,
    display.initialScale,
    display.nightLight,
    display.nightLightStrength,
    display.textReflow,
    tabId,
    url,
  ]);

  return {
    textZoom: touched.zoom || zoomChanged ? display.textZoom : undefined,
    forceDarkOn: touched.dark || display.forceDark ? display.forceDark : undefined,
    script,
  };
}
