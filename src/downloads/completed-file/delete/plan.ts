/**
 * Phase 7C — completed-file delete plan (pure).
 */

export type DeletePlan =
  | {
      kind: 'reject';
      reason: 'NOT_COMPLETED' | 'ACTIVE_TRANSFER' | 'BUSY';
    }
  | {
      kind: 'delete_private';
      downloadId: string;
      /** Physical file exists — delete file first, then catalog. */
      physicalPresent: boolean;
      /** Public MediaStore copy must NOT be deleted. */
      preservePublicExport: true;
      /** Dismiss VidoraX completion notification if possible. */
      dismissNotification: true;
    };

export function resolveDeletePlan(input: {
  downloadId: string;
  status: string | null | undefined;
  physicalFilePresent: boolean;
  opBusy?: boolean;
}): DeletePlan {
  if (input.opBusy) {
    return { kind: 'reject', reason: 'BUSY' };
  }
  const status = (input.status ?? '').toUpperCase();
  if (
    status === 'DOWNLOADING' ||
    status === 'QUEUED' ||
    status === 'PAUSED' ||
    status === 'RETRYING' ||
    status === 'FINALIZING' ||
    status === 'PREPARING' ||
    status === 'STARTING' ||
    status === 'WAITING_FOR_WIFI'
  ) {
    return { kind: 'reject', reason: 'ACTIVE_TRANSFER' };
  }
  if (status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELLED') {
    // Missing/unknown: allow catalog cleanup only when caller treats as completed-file surface.
    if (status && status !== 'COMPLETED') {
      return { kind: 'reject', reason: 'NOT_COMPLETED' };
    }
  }
  if (status !== 'COMPLETED') {
    // 7C completed-file delete is for COMPLETED; active jobs use Phase 1 cancel path.
    return { kind: 'reject', reason: 'NOT_COMPLETED' };
  }

  return {
    kind: 'delete_private',
    downloadId: input.downloadId,
    physicalPresent: input.physicalFilePresent === true,
    preservePublicExport: true,
    dismissNotification: true,
  };
}

export function classifyCompletedFilePresence(input: {
  status: string | null | undefined;
  physicalFilePresent: boolean;
}): {
  canPlay: boolean;
  canOpen: boolean;
  canShare: boolean;
  canExport: boolean;
  canRemoveFromLibrary: boolean;
} {
  const completed = (input.status ?? '').toUpperCase() === 'COMPLETED';
  const present = completed && input.physicalFilePresent;
  return {
    canPlay: present,
    canOpen: present,
    canShare: present,
    canExport: present,
    canRemoveFromLibrary: completed,
  };
}
