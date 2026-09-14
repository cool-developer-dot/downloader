/**
 * Support submission service.
 *
 * Submission modes:
 *   - Configured support email → mailto: via openExternalUrl
 *   - Unavailable → returns 'unavailable' status, no fake success
 *
 * Security contract:
 *   - Only sends allowlisted ReportPayload fields.
 *   - Never logs tokens, credentials, or source URLs.
 *   - Never serialises entire Zustand stores or request objects.
 *   - Idempotency: caller must guard against duplicate taps while sending.
 */

import { openExternalUrl } from '@/utils/open-external-url';

import { collectDiagnostics } from './diagnostics';
import type { ReportDiagnostics, ReportPayload, ReportSubmissionStatus } from './report-types';
import { getSupportEmail, getSupportSubmissionMode } from './support-config';
import type { ValidatedReport } from './validation';

export type SubmitReportResult = {
  status: Extract<ReportSubmissionStatus, 'success' | 'failure' | 'unavailable'>;
  /** Human-facing detail for failure only; never contains sensitive data. */
  detail?: string;
};

/**
 * Builds a safe mailto: URL for a report.
 * Sanitises subject and body — no raw HTML, no token injection.
 */
function buildMailtoUrl(
  email: string,
  payload: ReportPayload,
): string {
  const subjectLine = `[VidoraX Report] ${payload.category}: ${payload.subject}`
    .slice(0, 200)
    .trim();

  const bodyParts: string[] = [
    `Category: ${payload.category}`,
    `Subject: ${payload.subject}`,
    '',
    payload.description,
  ];

  if (payload.diagnostics) {
    const d = payload.diagnostics;
    bodyParts.push('', '--- Technical Details ---');
    bodyParts.push(`Version: ${d.appVersion}`);
    bodyParts.push(`Build: ${d.buildNumber}`);
    bodyParts.push(`Platform: ${d.platform}`);
    bodyParts.push(`OS: ${d.osVersion}`);
    bodyParts.push(`Device: ${d.deviceModel}`);
    bodyParts.push(`Language: ${d.appLocale}`);
    bodyParts.push(`Timestamp: ${d.timestamp}`);
  }

  const body = bodyParts.join('\n');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`;
}

/**
 * Builds a safe ReportPayload from a validated report + optional diagnostics flag.
 * SECURITY: only allowlisted fields are included.
 */
export function buildReportPayload(
  report: ValidatedReport,
  includeDiagnostics: boolean,
): ReportPayload {
  let diagnostics: ReportDiagnostics | null = null;
  if (includeDiagnostics) {
    diagnostics = collectDiagnostics(report.category);
  }

  return {
    category: report.category,
    subject: report.subject,
    description: report.description,
    diagnostics,
  };
}

/**
 * Submits the report using the available mode.
 * Never throws — returns a result object with status.
 * Never produces fake success.
 */
export async function submitReport(payload: ReportPayload): Promise<SubmitReportResult> {
  const mode = getSupportSubmissionMode();

  if (mode === 'unavailable') {
    return { status: 'unavailable' };
  }

  if (mode === 'email') {
    const email = getSupportEmail();
    if (!email) {
      return { status: 'unavailable' };
    }

    try {
      const mailtoUrl = buildMailtoUrl(email, payload);
      const opened = await openExternalUrl(mailtoUrl);
      if (opened) {
        return { status: 'success' };
      }
      return {
        status: 'failure',
        detail: 'Email app could not be opened',
      };
    } catch {
      return { status: 'failure', detail: 'Email launch failed' };
    }
  }

  return { status: 'unavailable' };
}
