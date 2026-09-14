/**
 * Phase 4B.2 — Support navigation helpers.
 *
 * Imports @/navigation (react-native / Expo Router) — ONLY use from React
 * Native components, NOT from Node-based verifier scripts.
 *
 * Components should import directly:
 *   import { openSupportWithContext } from '@/support/support-navigation';
 */

import { push } from '@/navigation';

import { SUPPORT_CONTEXT_PARAMS } from './support-context';
import type { SupportContext } from './support-context';

const SOURCE_MAX_LENGTH = 80;

/**
 * Navigates to the Support screen with optional contextual hints.
 * Only safe semantic IDs and a trimmed source label are passed.
 * SECURITY: No raw errors, URLs, paths, or tokens allowed in params.
 */
export function openSupportWithContext(ctx: SupportContext = {}): void {
  const params: Record<string, string> = {};
  if (ctx.categoryId) {
    params[SUPPORT_CONTEXT_PARAMS.categoryId] = ctx.categoryId;
  }
  if (ctx.faqId) {
    params[SUPPORT_CONTEXT_PARAMS.faqId] = ctx.faqId;
  }
  if (ctx.reportCategory) {
    params[SUPPORT_CONTEXT_PARAMS.reportCategory] = ctx.reportCategory;
  }
  if (ctx.source) {
    params[SUPPORT_CONTEXT_PARAMS.source] = ctx.source.slice(0, SOURCE_MAX_LENGTH);
  }

  if (Object.keys(params).length === 0) {
    push('/support');
  } else {
    push({ pathname: '/support', params } as Parameters<typeof push>[0]);
  }
}

/**
 * Navigates to the Report a Problem screen with optional contextual prefill.
 * Only safe semantic IDs and a trimmed source label are passed.
 * SECURITY: No raw errors, URLs, paths, or tokens allowed in params.
 */
export function openReportWithContext(
  ctx: Pick<SupportContext, 'reportCategory' | 'source'> = {},
): void {
  const params: Record<string, string> = {};
  if (ctx.reportCategory) {
    params[SUPPORT_CONTEXT_PARAMS.reportCategory] = ctx.reportCategory;
  }
  if (ctx.source) {
    params[SUPPORT_CONTEXT_PARAMS.source] = ctx.source.slice(0, SOURCE_MAX_LENGTH);
  }

  if (Object.keys(params).length === 0) {
    push('/report-problem');
  } else {
    push({
      pathname: '/report-problem',
      params,
    } as Parameters<typeof push>[0]);
  }
}
