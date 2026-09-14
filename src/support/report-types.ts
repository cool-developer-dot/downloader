/**
 * Phase 4B.1 — Report model types.
 * Keep fields minimal. No raw HTML. No sensitive data in this DTO.
 */

/** Typed report categories — stable identifiers. */
export type ReportCategoryId =
  | 'download'
  | 'browser'
  | 'playback'
  | 'file'
  | 'account'
  | 'other';

export const REPORT_CATEGORY_IDS: readonly ReportCategoryId[] = [
  'download',
  'browser',
  'playback',
  'file',
  'account',
  'other',
] as const;

/** Subject length bounds */
export const REPORT_SUBJECT_MIN = 5;
export const REPORT_SUBJECT_MAX = 120;

/** Description length bounds */
export const REPORT_DESCRIPTION_MIN = 20;
export const REPORT_DESCRIPTION_MAX = 2000;

/**
 * Safe diagnostic snapshot that may be attached to a report.
 * Allowlisted fields only — no tokens, paths, or secrets.
 */
export type ReportDiagnostics = {
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly platform: string;
  readonly osVersion: string;
  readonly deviceModel: string;
  readonly appLocale: string;
  readonly appTheme: string;
  readonly issueCategory: ReportCategoryId | null;
  readonly timestamp: string;
};

/**
 * User-facing draft before submission. The optional includeDiagnostics
 * flag controls whether ReportDiagnostics is attached to the payload.
 */
export type ReportDraft = {
  category: ReportCategoryId | null;
  subject: string;
  description: string;
  includeDiagnostics: boolean;
};

export const EMPTY_REPORT_DRAFT: ReportDraft = {
  category: null,
  subject: '',
  description: '',
  includeDiagnostics: true,
};

/** Submission lifecycle states */
export type ReportSubmissionStatus =
  | 'idle'
  | 'validating'
  | 'sending'
  | 'success'
  | 'failure'
  | 'unavailable';

/** Validated and ready-to-submit payload */
export type ReportPayload = {
  readonly category: ReportCategoryId;
  readonly subject: string;
  readonly description: string;
  readonly diagnostics: ReportDiagnostics | null;
};

/** Validation error shape */
export type ReportValidationErrors = {
  category?: string;
  subject?: string;
  description?: string;
};
