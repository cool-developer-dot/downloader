export {
  SUPPORT_ACTIONS,
  getSupportAction,
  isValidSupportActionRoute,
} from './actions';
export {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_IDS,
  getSupportCategory,
} from './categories';
/**
 * diagnostics.ts and support-service.ts import react-native / expo-device.
 * They MUST be imported directly in React components — NOT through this index —
 * so that Node-based verifier scripts can import the index safely.
 *
 * Use these direct paths in React components:
 *   import { collectDiagnostics } from '@/support/diagnostics';
 *   import { buildReportPayload, submitReport } from '@/support/support-service';
 */
export {
  SUPPORT_FAQ_IDS,
  SUPPORT_FAQ_ITEMS,
  getFaqsByCategory,
  getPopularFaqs,
  getSupportFaqById,
} from './faq-content';
export {
  EMPTY_REPORT_DRAFT,
  REPORT_CATEGORY_IDS,
  REPORT_DESCRIPTION_MAX,
  REPORT_DESCRIPTION_MIN,
  REPORT_SUBJECT_MAX,
  REPORT_SUBJECT_MIN,
} from './report-types';
export type {
  ReportCategoryId,
  ReportDiagnostics,
  ReportDraft,
  ReportPayload,
  ReportSubmissionStatus,
  ReportValidationErrors,
} from './report-types';
export { searchSupportFaqs, type SupportSearchHit } from './search';
export {
  DOWNLOAD_DEFAULT_SUPPORT_CONTEXT,
  DOWNLOAD_ERROR_SUPPORT_CONTEXT,
  FILE_UNAVAILABLE_SUPPORT_CONTEXT,
  PLAYER_ERROR_SUPPORT_CONTEXT,
  SUPPORT_CONTEXT_PARAMS,
  getDownloadSupportContext,
  getPlayerSupportContext,
  hasSupportContext,
  parseSupportContextParams,
  validateContextCategoryId,
  validateContextFaqId,
  validateContextReportCategory,
  validateContextSource,
} from './support-context';
export type { SupportContext } from './support-context';
/**
 * support-navigation.ts imports @/navigation (react-native/expo-router).
 * MUST be imported directly in React Native components — NOT through this index.
 * Node-based verifier scripts must not trigger this import.
 *
 * Use in React Native components:
 *   import { openSupportWithContext, openReportWithContext } from '@/support/support-navigation';
 */
export {
  canSubmitSupportReport,
  getSupportEmail,
  getSupportSubmissionMode,
} from './support-config';
export type { SupportSubmissionMode } from './support-config';
export type { SubmitReportResult } from './support-service';
export type {
  SupportAction,
  SupportActionId,
  SupportCategory,
  SupportCategoryId,
  SupportFaqItem,
} from './types';
export {
  getValidationMessageKey,
  validateReportDraft,
} from './validation';
export type { ValidatedReport, ValidationResult } from './validation';
