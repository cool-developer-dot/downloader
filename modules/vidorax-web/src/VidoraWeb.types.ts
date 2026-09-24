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

export interface WebDownloadEvent {
  viewTag: number;
  url: string;
  userAgent: string;
  contentDisposition: string | null;
  mimeType: string | null;
  contentLength: number | null;
}

export interface SharedTextEvent {
  /** Raw EXTRA_TEXT (may contain a caption around the URL; JS extracts the first http(s) URL). */
  text: string;
}

export type VidoraWebEvents = {
  onNetworkMedia: (event: NetworkMediaBatchEvent) => void;
  onWebDownload: (event: WebDownloadEvent) => void;
  /** A link was shared to the app while it was running. */
  onSharedText: (event: SharedTextEvent) => void;
};

export interface VidoraWebModuleApi {
  setNetworkObservationEnabled(enabled: boolean): void;
  /** Persist WebView cookies to disk (call when the app goes to background). */
  flushCookies(): Promise<void>;
  /**
   * Safe intent:// handoff: strips component/selector, blocks file/content/javascript targets.
   * Resolves false when no activity can handle it.
   */
  launchIntentUri(uri: string): Promise<boolean>;
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
