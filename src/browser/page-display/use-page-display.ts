import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type WebView from 'react-native-webview';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { useTheme } from '@/hooks/use-theme';
import { useSettingsStore } from '@/store/settings';

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
} from './page-display-settings';

export const pageDisplayNative = createPageDisplayNative(() => (isVidoraWebAvailable() ? getVidoraWeb() : null));

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
 * script again when a choice changes (the page in front updates at once), and the native layout / colour matrix.
 * `applyNative(tag)` is called by the WebView whenever its native view is bound.
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

  const matrix = useMemo(
    () => displayMatrix(display.colorFilter, display.nightLight, display.nightLightStrength),
    [display.colorFilter, display.nightLight, display.nightLightStrength],
  );
  const layout = useMemo(
    () => ({ textReflow: display.textReflow, initialScale: display.initialScale, darkening: display.forceDark }),
    [display.forceDark, display.initialScale, display.textReflow],
  );

  const applyNative = useCallback(
    (tag: number | null) => {
      pageDisplayNative.applyLayout(tag, layout);
      pageDisplayNative.applyFilter(tag, matrix);
    },
    [layout, matrix],
  );
  useEffect(() => {
    if (tabId) applyNative(getTabWebViewTag(tabId));
  }, [applyNative, tabId]);

  return {
    textZoom: touched.zoom || zoomChanged ? display.textZoom : undefined,
    forceDarkOn: touched.dark || display.forceDark ? display.forceDark : undefined,
    script,
    applyNative,
  };
}
