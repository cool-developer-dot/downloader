/**
 * Phase 7C — export receipt / pending transaction model (pure, non-secret).
 */

export type ExportReceipt = {
  exportedContentUri: string | null;
  exportedDisplayName: string | null;
  exportedAt: string | null;
  pendingExportUri: string | null;
  pendingExportStartedAt: string | null;
};

export type ExportReceiptQualification =
  | { kind: 'none' }
  | { kind: 'pending'; uri: string; startedAt: string | null }
  | { kind: 'published'; uri: string; displayName: string | null; exportedAt: string | null }
  | { kind: 'stale_published'; uri: string };

export function emptyExportReceipt(): ExportReceipt {
  return {
    exportedContentUri: null,
    exportedDisplayName: null,
    exportedAt: null,
    pendingExportUri: null,
    pendingExportStartedAt: null,
  };
}

/** Receipt may only hold non-secret MediaStore identifiers + display name. */
export function assertSafeExportReceiptFields(receipt: ExportReceipt): void {
  const blob = JSON.stringify(receipt).toLowerCase();
  for (const forbidden of [
    'cookie',
    'authorization',
    'requestcontext',
    'bearer ',
    'set-cookie',
  ]) {
    if (blob.includes(forbidden)) {
      throw new Error(`Forbidden export receipt field content: ${forbidden}`);
    }
  }
  for (const value of [
    receipt.exportedContentUri,
    receipt.pendingExportUri,
    receipt.exportedDisplayName,
  ]) {
    if (value && /[?&](token|sig|signature|auth)=/i.test(value)) {
      throw new Error('Forbidden signed query in export receipt');
    }
  }
}

export function qualifyExistingExportReceipt(
  receipt: ExportReceipt,
  options?: { publicUriExists?: boolean | null },
): ExportReceiptQualification {
  if (receipt.pendingExportUri?.trim()) {
    return {
      kind: 'pending',
      uri: receipt.pendingExportUri.trim(),
      startedAt: receipt.pendingExportStartedAt,
    };
  }
  const uri = receipt.exportedContentUri?.trim();
  if (!uri) {
    return { kind: 'none' };
  }
  if (options?.publicUriExists === false) {
    return { kind: 'stale_published', uri };
  }
  if (options?.publicUriExists === true || options?.publicUriExists == null) {
    // When existence unknown, treat as published (caller revalidates on Save).
    return {
      kind: 'published',
      uri,
      displayName: receipt.exportedDisplayName,
      exportedAt: receipt.exportedAt,
    };
  }
  return { kind: 'none' };
}

export function beginExportTransaction(
  pendingUri: string,
  startedAt: string,
): Pick<ExportReceipt, 'pendingExportUri' | 'pendingExportStartedAt'> {
  return {
    pendingExportUri: pendingUri.trim(),
    pendingExportStartedAt: startedAt,
  };
}

export function completeExportTransaction(input: {
  contentUri: string;
  displayName: string;
  exportedAt: string;
}): ExportReceipt {
  return {
    exportedContentUri: input.contentUri.trim(),
    exportedDisplayName: input.displayName.trim(),
    exportedAt: input.exportedAt,
    pendingExportUri: null,
    pendingExportStartedAt: null,
  };
}

export function failExportTransaction(): Pick<
  ExportReceipt,
  'pendingExportUri' | 'pendingExportStartedAt'
> {
  return {
    pendingExportUri: null,
    pendingExportStartedAt: null,
  };
}

/**
 * Startup reconciliation decision for a known pending export.
 * Never deletes a fully published public item.
 */
export function reconcilePendingExport(input: {
  pendingUri: string | null | undefined;
  publishedUri: string | null | undefined;
  pendingStillIncomplete: boolean | null;
}): {
  shouldDeletePendingRow: boolean;
  clearPendingMarker: boolean;
  keepPublishedReceipt: boolean;
} {
  const pending = input.pendingUri?.trim() || null;
  const published = input.publishedUri?.trim() || null;

  if (!pending) {
    return {
      shouldDeletePendingRow: false,
      clearPendingMarker: false,
      keepPublishedReceipt: Boolean(published),
    };
  }

  // Same URI as published → do not delete (published copy).
  if (published && pending === published) {
    return {
      shouldDeletePendingRow: false,
      clearPendingMarker: true,
      keepPublishedReceipt: true,
    };
  }

  if (input.pendingStillIncomplete === true) {
    return {
      shouldDeletePendingRow: true,
      clearPendingMarker: true,
      keepPublishedReceipt: Boolean(published),
    };
  }

  if (input.pendingStillIncomplete === false) {
    // Pending row no longer incomplete — clear marker only.
    return {
      shouldDeletePendingRow: false,
      clearPendingMarker: true,
      keepPublishedReceipt: Boolean(published),
    };
  }

  // Unknown: clear marker conservatively without deleting unknown public rows.
  return {
    shouldDeletePendingRow: false,
    clearPendingMarker: true,
    keepPublishedReceipt: Boolean(published),
  };
}
