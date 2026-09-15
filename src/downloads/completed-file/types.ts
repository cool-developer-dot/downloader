/**
 * Phase 7A — completed-file identity types.
 * Conceptual CompletedFileDescriptor; no secrets, no transfer auth context.
 */

export type CompletedMediaContainer =
  | 'mp4'
  | 'm4v'
  | 'mov'
  | 'avi'
  | 'wmv'
  | 'webm'
  | 'ts'
  | 'm4a'
  | 'unknown';

export type LibraryDownloadStateGroup =
  | 'active_transitional'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type CompletedFileDescriptor = {
  downloadId: string;
  fileName: string;
  canonicalPath: string | null;
  mimeType: string | null;
  container: CompletedMediaContainer;
  fileSize: string | null;
  completedAt: string | null;
  displayTitle: string;
  sourceHost: string | null;
  mediaIdentity: string | null;
  thumbnailUri: string | null;
  qualityLabel: string | null;
  /** True when the physical file was confirmed present for this descriptor. */
  physicalFilePresent: boolean;
};

export type CompletedFileActions = {
  canPlay: boolean;
  canOpen: boolean;
  canShare: boolean;
  canDelete: boolean;
  canExport: boolean;
};

export type CompletedValidationEvidence = {
  /** Structural signature kind from Phase 1 validation. */
  signatureKind?: string | null;
  /** Trusted capability / analysis MIME when known. */
  verifiedMimeType?: string | null;
  /** Analysis / worker container hint (never fabricated). */
  containerHint?: string | null;
  /** Declared response MIME (low confidence if octet-stream). */
  responseMimeType?: string | null;
  /** URL path extension only — lowest confidence. */
  urlExtension?: string | null;
  /** Content-Disposition basename — title hint only; never path authority. */
  contentDispositionFileName?: string | null;
};

export type ResolveCompletedDescriptorInput = {
  downloadId: string;
  status: string | null | undefined;
  /** Current on-disk / catalog file name. */
  fileName?: string | null;
  /** App-private canonical URI when known. */
  canonicalPath?: string | null;
  displayTitle?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  sourceHost?: string | null;
  mediaIdentity?: string | null;
  thumbnailUri?: string | null;
  qualityLabel?: string | null;
  /** Persisted completed timestamp (downloadedAt). */
  completedAt?: string | null;
  /** Actual filesystem size when known; never invent. */
  fileSizeBytes?: number | string | null;
  physicalFilePresent?: boolean;
  /** True only after Phase 1 validation succeeded for this artifact. */
  validationSucceeded?: boolean;
  evidence?: CompletedValidationEvidence;
  /** When true, skip inventing a new basename — only normalize extension/MIME. */
  preserveExistingBaseName?: boolean;
};
