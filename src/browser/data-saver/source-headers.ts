import { DO_NOT_TRACK_HEADERS } from '../privacy/privacy-page-script';

/**
 * B18 #184 — the `Save-Data: on` request header while Data saver is on, sent the same way B12 sends Do Not Track: in the
 * headers of the WebView `source`, merged with the DNT headers. So it reaches the pages the browser opens itself (a
 * typed address, a restored tab, a reload), not the page's own links and resources — requests are never fetched again
 * natively to add headers.
 *
 * It follows the Data saver **setting**, not its Wi-Fi / mobile-data effects: any change to `source` makes
 * react-native-webview load it again, so a header that changed with the network would reload the tab.
 */
export const SAVE_DATA_HEADERS: Readonly<Record<string, string>> = { 'Save-Data': 'on' };

export type WebViewSource = { uri: string; headers?: Record<string, string> };

/** The WebView source for `uri`: exactly `{ uri }` when no header is on (today's source, no `headers` key). */
export function webViewSourceFor(uri: string, options: { doNotTrack: boolean; saveData: boolean }): WebViewSource {
  if (!options.doNotTrack && !options.saveData) return { uri };
  return {
    uri,
    headers: {
      ...(options.doNotTrack ? DO_NOT_TRACK_HEADERS : {}),
      ...(options.saveData ? SAVE_DATA_HEADERS : {}),
    },
  };
}
