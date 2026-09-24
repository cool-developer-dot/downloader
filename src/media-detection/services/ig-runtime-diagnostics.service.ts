/**
 * DEV-only Instagram / WebView runtime diagnostics.
 * Never logs cookie values, tokens, or private session data.
 */

export type IgRuntimeStage =
  | 'webview_mount'
  | 'webview_unmount'
  | 'webview_source'
  | 'navigation'
  | 'playback'
  | 'network_candidate'
  | 'correlated_candidate'
  | 'verified_candidate'
  | 'store_insert'
  /** Discovery selected a current candidate; the CTA itself is gated by verification. */
  | 'discovery_media_selected'
  | 'quality_open'
  | 'download_handoff';

export type IgFlickerStage =
  | 'source_changed'
  | 'key_changed'
  | 'reload'
  | 'load_url'
  | 'desktop_mode'
  | 'webview_render';

type Payload = Record<string, string | number | boolean | null | undefined>;

function safePayload(payload: Payload): Payload {
  const out: Payload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      key.toLowerCase().includes('cookie') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logIgRuntime(stage: IgRuntimeStage, payload: Payload = {}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log(`[IGRuntime:${stage}]`, safePayload(payload));
}

export function logIgFlicker(stage: IgFlickerStage, payload: Payload = {}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log(`[IGFlicker:${stage}]`, safePayload(payload));
}
