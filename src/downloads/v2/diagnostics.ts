/** Safe __DEV__ trace for the v2 download actions — ids are hashed, URLs and headers never logged. */

type V2ActionEvent =
  | 'action_requested'
  | 'action_accepted'
  | 'action_failed'
  | 'state_event'
  | 'remove_requested'
  | 'remove_failed'
  | 'notification_permission'
  | 'progress_coalesced'
  | 'library_file_missing'
  | 'library_reconcile_failed';

function hashId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function logV2Download(
  event: V2ActionEvent,
  fields: {
    downloadId?: string | null;
    action?: string | null;
    state?: string | null;
    owned?: boolean;
    code?: string | null;
    message?: string | null;
    bytesDone?: number | null;
    /** Engine progress events seen vs. handed to the store (coalescer). */
    received?: number | null;
    applied?: number | null;
  } = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[V2Download]', {
    event,
    idHash: hashId(fields.downloadId),
    action: fields.action ?? null,
    state: fields.state ?? null,
    owned: fields.owned ?? null,
    code: fields.code ?? null,
    message: fields.message?.slice(0, 120) ?? null,
    bytesDone: fields.bytesDone ?? null,
    received: fields.received ?? null,
    applied: fields.applied ?? null,
  });
}
