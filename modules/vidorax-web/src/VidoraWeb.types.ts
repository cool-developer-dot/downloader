/**
 * Contract for the native `VidoraWeb` Expo module (modules/vidorax-web/android).
 *
 * Its Kotlin code is called by hooks that scripts/patch-react-native-webview.js adds to react-native-webview:
 * WebView creation (service-worker request observation), shouldInterceptRequest (network observer) and the WebView
 * DownloadListener (file download handoff). It also reads links shared to the app (ACTION_SEND text/plain).
 * Any change here must be mirrored in Kotlin in the same commit.
 */

export type NetworkMediaHint =
  | 'manifest-hls'
  | 'manifest-dash'
  | 'progressive'
  /** HLS/DASH segment or init segment: evidence a stream is playing, not a downloadable item by itself. */
  | 'segment'
  /** Request with a Range header or byte-range query params to a media-looking URL. */
  | 'range-media'
  | 'unknown';

export interface NetworkMediaObservation {
  /** React view tag of the RNCWebViewWrapper that issued the request; -1 when it came from a service worker. */
  viewTag: number;
  url: string;
  method: string;
  isMainFrame: boolean;
  /** True when the request carried a Range header (including suffix ranges, which have no rangeStart). */
  hasRange: boolean;
  /** Start offset from the Range header, when present. */
  rangeStart: number | null;
  accept: string | null;
  referer: string | null;
  hint: NetworkMediaHint;
  /** Epoch milliseconds. */
  observedAt: number;
}

export interface NetworkMediaBatchEvent {
  observations: NetworkMediaObservation[];
}

/**
 * A download the WebView started (a navigation or link whose response it cannot render: a pasted `.mpd` or `.mov`,
 * a file served as an attachment) that looks like a video. Only those are sent — every other download goes to
 * Android's DownloadManager as before. `hint` comes from the response's MIME type or file name; `unknown` is a
 * generic binary with no usable name, which JS must either identify as a video or hand back with
 * `startSystemDownload`.
 *
 * H17: `risky` is an app or program file (the Dangerous File Warning's list, by name or MIME type) that is sent here
 * only so JS can show the warning first: it is handed to `startSystemDownload` if the user confirms, else dropped.
 * Older native builds never send it (those files went straight to DownloadManager).
 */
export interface WebDownloadEvent {
  viewTag: number;
  url: string;
  userAgent: string;
  contentDisposition: string | null;
  mimeType: string | null;
  contentLength: number | null;
  hint: Extract<NetworkMediaHint, 'manifest-hls' | 'manifest-dash' | 'progressive' | 'unknown'> | 'risky';
}

export interface SharedTextEvent {
  /** Raw EXTRA_TEXT (may contain a caption around the URL; JS extracts the first http(s) URL). */
  text: string;
}

/** B1 #14: a JPEG of what a tab's WebView showed, in the app's cache directory. */
export interface WebViewSnapshot {
  /** `file://` URI of `<cacheDir>/tab-previews/<key>.jpg`. */
  uri: string;
  width: number;
  height: number;
}

/** B6 #44: a tab's back/forward list as its WebView keeps it, oldest first (≤ 50 entries around the current one). */
export interface WebViewHistory {
  /** Index of the page shown now in `entries`. */
  currentIndex: number;
  /** `url` is empty for an entry the WebView keeps no address for. */
  entries: { url: string; title: string }[];
}

/** B6 #240 / B21: a key the app took from the system while `setKeyCapture` asked for it. */
export interface CapturedKeyEvent {
  /** `volumeUp`, `volumeDown`, or a shortcut combo such as `ctrl+t` / `ctrl+shift+tab` (B21). */
  key: string;
  /** True for the repeats of a held key. */
  repeat: boolean;
}

/** B6 #45: how the system's navigation is shown (Settings.Secure `navigation_mode`). */
export type NavigationMode = 'gesture' | 'twoButton' | 'threeButton' | 'unknown';

export type VidoraWebEvents = {
  onNetworkMedia: (event: NetworkMediaBatchEvent) => void;
  onWebDownload: (event: WebDownloadEvent) => void;
  /** A link was shared to the app while it was running. */
  onSharedText: (event: SharedTextEvent) => void;
  /** B6 #240 / B21: a captured key was pressed (sent on key down only; the key up is swallowed too). */
  onCapturedKey: (event: CapturedKeyEvent) => void;
};

export interface VidoraWebModuleApi {
  setNetworkObservationEnabled(enabled: boolean): void;
  /**
   * Parks (`false`) or wakes (`true`) the WebView whose RNCWebViewWrapper has this view tag: `WebView.onPause()` /
   * `onResume()`, so a parked page is hidden (`document.hidden`), stops drawing, animating and playing, and its media
   * requests are no longer reported. Resolves false when no such WebView exists.
   */
  setWebViewActive(viewTag: number, active: boolean): Promise<boolean>;
  /**
   * B1 #14 Tab preview: draws the visible part of the page in the WebView whose RNCWebViewWrapper has this view tag
   * into a JPEG at most `maxWidth` pixels wide (aspect ratio kept, never scaled up; `maxWidth` is clamped to
   * 64–1080), written atomically to `<cacheDir>/tab-previews/<key>.jpg` (`key`: 1–64 of `A–Z a–z 0–9 _ -`, else the
   * call resolves null). Drawing runs on the main thread, JPEG encoding off it. Resolves null when there is no such
   * WebView or it has no size yet. Missing on older native builds.
   */
  snapshotWebView?(viewTag: number, maxWidth: number, key: string): Promise<WebViewSnapshot | null>;
  /**
   * Settings → Theme for Android itself: kept natively and applied before the first activity frame on every start,
   * and on Android 12+ given to the system (`UiModeManager.setApplicationNightMode`) so its splash follows the app's
   * theme. `system` follows the device. Returns the mode applied. Missing on older native builds.
   */
  setAppNightMode?(mode: 'light' | 'dark' | 'system'): string;
  /**
   * B6 #44 Long-press Back: the back/forward list of the WebView whose RNCWebViewWrapper has this view tag
   * (`WebView.copyBackForwardList()`, main thread). Resolves null when there is no such WebView. Missing on older
   * native builds.
   */
  getWebViewHistory?(viewTag: number): Promise<WebViewHistory | null>;
  /**
   * B6 #44: moves `steps` entries through that WebView's history (negative = back), like pressing Back `-steps`
   * times at once. Resolves false when there is no such WebView or no entry that far. Missing on older native builds.
   */
  goBackOrForward?(viewTag: number, steps: number): Promise<boolean>;
  /**
   * B6 #240 / B21: which keys the app takes from the system — Volume Up / Down when `volumeKeys`, and the shortcut
   * combos listed in `combos` (B21; e.g. `ctrl+t`). A captured key is reported as `onCapturedKey` and does nothing
   * else (no volume change). Every other key keeps its normal job, and so does every key while nothing listens to
   * `onCapturedKey`. Keys pressed in a dialog or another window are never captured. Missing on older native builds.
   */
  setKeyCapture?(volumeKeys: boolean, combos: readonly string[]): void;
  /** B6 #45: the system navigation mode, read now. Missing on older native builds. */
  getNavigationMode?(): NavigationMode;
  /**
   * B6 #55 Page preloading: resolves `host` (a DNS name, not an IP) in the background, at most once a minute per
   * host, so a following page load skips the lookup. Invalid hosts are ignored. Missing on older native builds.
   */
  prefetchDns?(host: string): void;
  /** Persist WebView cookies to disk (call when the app goes to background). */
  flushCookies(): Promise<void>;
  /**
   * Safe intent:// handoff: strips component/selector, blocks file/content/javascript targets.
   * Resolves false when no activity can handle it.
   */
  launchIntentUri(uri: string): Promise<boolean>;
  /**
   * Hands a download that `onWebDownload` claimed back to Android's DownloadManager, as react-native-webview would
   * have started it. Resolves false when it could not be started.
   */
  startSystemDownload(
    url: string,
    userAgent: string | null,
    contentDisposition: string | null,
    mimeType: string | null,
  ): Promise<boolean>;
  /** User-Agent of a WebView with default settings, for requests not tied to a tab. */
  getDefaultUserAgent(): string;
  /**
   * Text from the ACTION_SEND intent that launched the app, returned once and then null.
   * Shares that arrive while the app is running are delivered as `onSharedText`.
   */
  consumeSharedText(): string | null;

  /** True when VidoraX is the device's default browser. */
  isDefaultBrowser(): boolean;

  /** False when this Android version/device offers no way to ask (or VidoraX already holds the role). */
  canRequestDefaultBrowser(): boolean;

  /** Opens the system's own dialog; never changes the setting by itself. */
  requestDefaultBrowser(): Promise<boolean>;
}
