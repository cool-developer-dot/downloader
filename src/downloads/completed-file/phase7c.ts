/**
 * Phase 7C — pure export / delete surfaces for Node verifiers.
 * Runtime services (native / Expo) are NOT re-exported here.
 */

export {
  resolveExportDestination,
  resolveExportCapability,
  type ExportCollection,
  type ExportDestination,
} from './export/destination';

export {
  resolvePublicExportName,
  nextCollisionSafePublicName,
  buildMediaStoreMetadata,
} from './export/public-name';

export {
  emptyExportReceipt,
  assertSafeExportReceiptFields,
  qualifyExistingExportReceipt,
  beginExportTransaction,
  completeExportTransaction,
  failExportTransaction,
  reconcilePendingExport,
  type ExportReceipt,
  type ExportReceiptQualification,
} from './export/receipt';

export {
  CompletedFileExportError,
  mapExportErrorMessageKey,
  isBenignExportCancellation,
  type CompletedFileExportErrorCode,
} from './export/errors';

export {
  resolveDeletePlan,
  classifyCompletedFilePresence,
  type DeletePlan,
} from './delete/plan';

export {
  getCompletedFileOpKind,
  isCompletedFileOpBusy,
  withCompletedFileOperation,
  resetCompletedFileOperationsForTests,
  type CompletedFileOpKind,
} from './operation-lock';
