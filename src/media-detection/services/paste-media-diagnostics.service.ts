/**
 * DEV-only Paste Link / page-resolution diagnostics.
 * Never logs cookie values, tokens, or session secrets.
 */

export type PasteMediaDiagnosticStage =
  | 'input'
  | 'platform'
  | 'canonical'
  | 'resolver_started'
  | 'browser_loaded'
  | 'waiting_playback'
  | 'candidate'
  | 'verified'
  | 'download_handoff'
  | 'failure';

export type PasteMediaDiagnosticPayload = Record<
  string,
  string | number | boolean | null | undefined
>;

export function logPasteMediaDiagnostic(
  stage: PasteMediaDiagnosticStage,
  payload: PasteMediaDiagnosticPayload = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  const safe: PasteMediaDiagnosticPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      key.toLowerCase().includes('cookie') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      continue;
    }
    safe[key] = value;
  }

  console.log(`[PasteMedia:${stage}]`, safe);
}
