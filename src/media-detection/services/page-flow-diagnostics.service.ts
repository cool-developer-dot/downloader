/**
 * DEV-only page-resolution state-machine diagnostics.
 * Never logs cookies, tokens, or session secrets.
 */

export type PageFlowStage =
  | 'input'
  | 'classified'
  | 'resolve_start'
  | 'canonical'
  | 'session_created'
  | 'navigation_queued'
  | 'navigate_browser'
  | 'sheet_close'
  | 'browser_focus'
  | 'navigation_consumed'
  | 'webview_load'
  | 'browser_loaded'
  | 'waiting_media'
  | 'candidate'
  | 'resolved'
  | 'quality_open'
  | 'timeout'
  | 'failure';

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

export function logPageFlow(stage: PageFlowStage, payload: Payload = {}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log(`[PageFlow:${stage}]`, safePayload(payload));
}

export function safePageHostname(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
