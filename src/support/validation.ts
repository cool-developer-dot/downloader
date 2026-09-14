/**
 * Phase 4B.1 — Report form validation.
 * Pure functions — no side effects, no I/O.
 */

import {
  REPORT_DESCRIPTION_MAX,
  REPORT_DESCRIPTION_MIN,
  REPORT_SUBJECT_MAX,
  REPORT_SUBJECT_MIN,
  type ReportCategoryId,
  type ReportDraft,
  type ReportValidationErrors,
} from './report-types';

export type ValidatedReport = {
  category: ReportCategoryId;
  subject: string;
  description: string;
};

export type ValidationResult =
  | { valid: true; data: ValidatedReport }
  | { valid: false; errors: ReportValidationErrors };

/**
 * Validates a report draft. Trims strings, enforces all constraints.
 * Returns either a cleaned ValidatedReport or a structured error map.
 */
export function validateReportDraft(draft: ReportDraft): ValidationResult {
  const errors: ReportValidationErrors = {};

  if (!draft.category) {
    errors.category = 'categoryRequired';
  }

  const subject = draft.subject.trim();
  if (subject.length === 0) {
    errors.subject = 'subjectRequired';
  } else if (subject.length < REPORT_SUBJECT_MIN) {
    errors.subject = 'subjectTooShort';
  } else if (subject.length > REPORT_SUBJECT_MAX) {
    errors.subject = 'subjectTooLong';
  }

  const description = draft.description.trim();
  if (description.length === 0) {
    errors.description = 'descriptionRequired';
  } else if (description.length < REPORT_DESCRIPTION_MIN) {
    errors.description = 'descriptionTooShort';
  } else if (description.length > REPORT_DESCRIPTION_MAX) {
    errors.description = 'descriptionTooLong';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      category: draft.category!,
      subject,
      description,
    },
  };
}

/**
 * Returns the i18n key for a validation error code.
 * Scoped to support.report.validation.*
 */
export function getValidationMessageKey(
  code: string,
): `support.report.validation.${string}` {
  return `support.report.validation.${code}` as `support.report.validation.${string}`;
}
