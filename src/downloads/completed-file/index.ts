/**
 * Phase 7A — completed file identity (what file did we download?).
 */

export type {
  CompletedFileActions,
  CompletedFileDescriptor,
  CompletedMediaContainer,
  CompletedValidationEvidence,
  LibraryDownloadStateGroup,
  ResolveCompletedDescriptorInput,
} from './types';

export {
  sanitizeCompletedFileName,
  completedFileStem,
  completedFileExtension,
  joinCompletedFileName,
  MAX_BASE_LENGTH,
  MAX_FILE_NAME_LENGTH,
} from './sanitize';

export {
  resolveCompletedContainer,
  resolveCompletedExtension,
  resolveCompletedMimeType,
  formatContainerLabel,
  isNonFinalMediaExtension,
} from './extension';

export { resolveCompletedFileName } from './naming';
export type { ResolveCompletedFileNameInput } from './naming';

export {
  resolveCompletedDescriptor,
  resolveLegacyCompletedDescriptor,
} from './descriptor';

export {
  classifyLibraryDownloadState,
  isCompletedLibraryGroup,
} from './state';

export {
  resolveCompletedActions,
} from './actions';
export type { ResolveCompletedActionsInput } from './actions';

export {
  CompletedFileActionError,
  mapCompletedActionError,
  completedActionErrorMessageKey,
} from './action-errors';
export type { CompletedFileActionErrorCode } from './action-errors';

export {
  isContentUri,
  isRawFileUri,
  resolveExternalHandoffMime,
  isUnsafeCallerPath,
  validateExternalContentUri,
  isVidoraExpoFileProviderUri,
  DEFAULT_VIDORAX_PACKAGE_ID,
  VIDORAX_EXPO_FILE_PROVIDER_AUTHORITY_SUFFIX,
} from './uri-safety';

// Runtime Open/Share/Play service lives in ./action-service.ts (Expo/RN).
// Do not re-export it from this barrel — Node verifiers import the pure surface.