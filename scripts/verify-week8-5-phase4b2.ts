/**
 * Week 8.5 Phase 4B.2 — Contextual Get Help, Error Integration, Support Certification.
 * Pure static / logic checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase4b2.ts
 *   npm run verify:week8-5-phase4b2
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasTranslationKey } from '../src/localization/translate';
import {
  SUPPORT_CATEGORY_IDS,
  SUPPORT_FAQ_IDS,
  REPORT_CATEGORY_IDS,
} from '../src/support';
import {
  SUPPORT_CONTEXT_PARAMS,
  parseSupportContextParams,
  validateContextCategoryId,
  validateContextFaqId,
  validateContextReportCategory,
  validateContextSource,
  getPlayerSupportContext,
  getDownloadSupportContext,
  hasSupportContext,
  PLAYER_ERROR_SUPPORT_CONTEXT,
  DOWNLOAD_ERROR_SUPPORT_CONTEXT,
  DOWNLOAD_DEFAULT_SUPPORT_CONTEXT,
  FILE_UNAVAILABLE_SUPPORT_CONTEXT,
} from '../src/support/support-context';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function readSrc(rel: string): string {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    throw new Error(`File not found: ${full}`);
  }
  return readFileSync(full, 'utf-8');
}

function hasEnKey(key: string): boolean {
  return hasTranslationKey(key, 'en');
}

function hasUrKey(key: string): boolean {
  return hasTranslationKey(key, 'ur');
}

// ─── Run tests ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
// 1. SupportContext module exists and exports required symbols
await test('support-context.ts — file exists', () => {
  readSrc('src/support/support-context.ts');
});

await test('support-context.ts — exported from support index', () => {
  const idx = readSrc('src/support/index.ts');
  assert(idx.includes('support-context'), 'support-context not exported from index');
  assert(idx.includes('parseSupportContextParams'), 'parseSupportContextParams not exported');
  assert(idx.includes('SupportContext'), 'SupportContext type not exported');
  // Navigation helpers are in support-navigation.ts (React-only, not in index for Node safety)
  const navSrc = readSrc('src/support/support-navigation.ts');
  assert(navSrc.includes('openSupportWithContext'), 'openSupportWithContext missing from support-navigation.ts');
  assert(navSrc.includes('openReportWithContext'), 'openReportWithContext missing from support-navigation.ts');
});

// 2. SupportContext param keys are frozen
await test('SUPPORT_CONTEXT_PARAMS — frozen semantic keys only', () => {
  const keys = Object.values(SUPPORT_CONTEXT_PARAMS);
  assert(keys.includes('categoryId'), 'categoryId param missing');
  assert(keys.includes('faqId'), 'faqId param missing');
  assert(keys.includes('reportCategory'), 'reportCategory param missing');
  assert(keys.includes('source'), 'source param missing');
  // Must NOT contain sensitive param names
  for (const k of keys) {
    assert(!k.toLowerCase().includes('token'), `param key must not contain token: ${k}`);
    assert(!k.toLowerCase().includes('url'), `param key must not contain url: ${k}`);
    assert(!k.toLowerCase().includes('path'), `param key must not contain path: ${k}`);
    assert(!k.toLowerCase().includes('secret'), `param key must not contain secret: ${k}`);
  }
});

// 3. Validation — categoryId must reject invalid values
await test('validateContextCategoryId — accepts valid, rejects invalid', () => {
  for (const id of SUPPORT_CATEGORY_IDS) {
    assert(validateContextCategoryId(id) === id, `valid categoryId rejected: ${id}`);
  }
  assert(validateContextCategoryId('hacked') === undefined, 'invalid categoryId accepted');
  assert(validateContextCategoryId(undefined) === undefined, 'undefined not handled');
  assert(validateContextCategoryId('') === undefined, 'empty string not handled');
});

// 4. Validation — faqId must reject invalid values
await test('validateContextFaqId — accepts valid, rejects invalid', () => {
  for (const id of SUPPORT_FAQ_IDS) {
    assert(validateContextFaqId(id) === id, `valid faqId rejected: ${id}`);
  }
  assert(validateContextFaqId('not-a-real-faq') === undefined, 'invalid faqId accepted');
  assert(validateContextFaqId(undefined) === undefined, 'undefined not handled');
});

// 5. Validation — reportCategory
await test('validateContextReportCategory — accepts valid, rejects invalid', () => {
  for (const id of REPORT_CATEGORY_IDS) {
    assert(
      validateContextReportCategory(id) === id,
      `valid reportCategory rejected: ${id}`,
    );
  }
  assert(
    validateContextReportCategory('injected') === undefined,
    'invalid reportCategory accepted',
  );
});

// 6. Validation — source clamped and sanitised
await test('validateContextSource — clamps to 80 chars', () => {
  const long = 'A'.repeat(200);
  const result = validateContextSource(long);
  assert(result !== undefined && result.length <= 80, 'source not clamped to 80 chars');
});

await test('validateContextSource — rejects empty/whitespace', () => {
  assert(validateContextSource('') === undefined, 'empty string not rejected');
  assert(validateContextSource('   ') === undefined, 'whitespace string not rejected');
  assert(validateContextSource(undefined) === undefined, 'undefined not rejected');
});

// 7. parseSupportContextParams — full round-trip
await test('parseSupportContextParams — valid params parsed correctly', () => {
  const result = parseSupportContextParams({
    categoryId: 'downloads',
    faqId: 'download-failed',
    reportCategory: 'download',
    source: 'Download failure',
  });
  assert(result.categoryId === 'downloads', 'categoryId not parsed');
  assert(result.faqId === 'download-failed', 'faqId not parsed');
  assert(result.reportCategory === 'download', 'reportCategory not parsed');
  assert(result.source === 'Download failure', 'source not parsed');
});

await test('parseSupportContextParams — invalid values silently ignored', () => {
  const result = parseSupportContextParams({
    categoryId: 'INJECTED_CATEGORY',
    faqId: 'fake-faq-id',
    reportCategory: 'hacked',
    source: '   ',
  });
  assert(result.categoryId === undefined, 'invalid categoryId not rejected');
  assert(result.faqId === undefined, 'invalid faqId not rejected');
  assert(result.reportCategory === undefined, 'invalid reportCategory not rejected');
  assert(result.source === undefined, 'whitespace source not rejected');
});

await test('parseSupportContextParams — no extra fields allowed in result', () => {
  const result = parseSupportContextParams({
    categoryId: 'playback',
    token: 'SHOULD_NOT_APPEAR',
    sourceUrl: 'https://evil.com',
  });
  const keys = Object.keys(result);
  const sensitiveKeys = ['token', 'sourceUrl', 'localUri', 'secret', 'password'];
  for (const sk of sensitiveKeys) {
    assert(!keys.includes(sk), `sensitive key leaked into context result: ${sk}`);
  }
  assert(result.categoryId === 'playback', 'valid categoryId not preserved');
});

// 8. Player error context — all codes produce valid mapped context
await test('getPlayerSupportContext — UNSUPPORTED_MEDIA maps to playback + faq', () => {
  const ctx = getPlayerSupportContext('UNSUPPORTED_MEDIA');
  assert(ctx.categoryId === 'playback', 'UNSUPPORTED_MEDIA categoryId wrong');
  assert(ctx.faqId === 'unsupported-codec', 'UNSUPPORTED_MEDIA faqId wrong');
  assert(ctx.reportCategory === 'playback', 'UNSUPPORTED_MEDIA reportCategory wrong');
});

await test('getPlayerSupportContext — FILE_UNAVAILABLE maps to library-files', () => {
  const ctx = getPlayerSupportContext('FILE_UNAVAILABLE');
  assert(ctx.categoryId === 'library-files', 'FILE_UNAVAILABLE categoryId wrong');
  assert(ctx.faqId === 'file-unavailable', 'FILE_UNAVAILABLE faqId wrong');
});

await test('getPlayerSupportContext — MEDIA_NOT_FOUND maps to library-files', () => {
  const ctx = getPlayerSupportContext('MEDIA_NOT_FOUND');
  assert(ctx.categoryId === 'library-files', 'MEDIA_NOT_FOUND categoryId wrong');
});

await test('getPlayerSupportContext — null fallback to PLAYBACK_FAILED context', () => {
  const ctx = getPlayerSupportContext(null);
  assert(ctx.categoryId === 'playback', 'null error fallback categoryId wrong');
});

await test('getPlayerSupportContext — all mapped contexts have valid category IDs', () => {
  for (const [code, ctx] of Object.entries(PLAYER_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.categoryId) {
      assert(
        (SUPPORT_CATEGORY_IDS as readonly string[]).includes(ctx.categoryId),
        `PLAYER_ERROR_SUPPORT_CONTEXT[${code}].categoryId invalid: ${ctx.categoryId}`,
      );
    }
    if (ctx.faqId) {
      assert(
        (SUPPORT_FAQ_IDS as readonly string[]).includes(ctx.faqId),
        `PLAYER_ERROR_SUPPORT_CONTEXT[${code}].faqId invalid: ${ctx.faqId}`,
      );
    }
    if (ctx.reportCategory) {
      assert(
        (REPORT_CATEGORY_IDS as readonly string[]).includes(ctx.reportCategory),
        `PLAYER_ERROR_SUPPORT_CONTEXT[${code}].reportCategory invalid: ${ctx.reportCategory}`,
      );
    }
    if (ctx.source) {
      assert(
        ctx.source.length <= 80,
        `PLAYER_ERROR_SUPPORT_CONTEXT[${code}].source exceeds 80 chars`,
      );
    }
  }
});

// 9. Download error context
await test('getDownloadSupportContext — INSUFFICIENT_STORAGE maps to account-settings', () => {
  const ctx = getDownloadSupportContext('INSUFFICIENT_STORAGE');
  assert(ctx.categoryId === 'account-settings', 'INSUFFICIENT_STORAGE categoryId wrong');
  assert(ctx.faqId === 'storage-settings', 'INSUFFICIENT_STORAGE faqId wrong');
});

await test('getDownloadSupportContext — UNSUPPORTED_DRM maps to downloads', () => {
  const ctx = getDownloadSupportContext('UNSUPPORTED_DRM');
  assert(ctx.categoryId === 'downloads', 'UNSUPPORTED_DRM categoryId wrong');
  assert(ctx.faqId === 'unsupported-source', 'UNSUPPORTED_DRM faqId wrong');
});

await test('getDownloadSupportContext — unknown code falls back to default', () => {
  const ctx = getDownloadSupportContext('SOME_FUTURE_ERROR');
  assert(
    ctx.categoryId === DOWNLOAD_DEFAULT_SUPPORT_CONTEXT.categoryId,
    'unknown download error code not falling back to default',
  );
});

await test('getDownloadSupportContext — null falls back to default', () => {
  const ctx = getDownloadSupportContext(null);
  assert(
    ctx.categoryId === DOWNLOAD_DEFAULT_SUPPORT_CONTEXT.categoryId,
    'null download error code not falling back to default',
  );
});

await test('getDownloadSupportContext — all mapped contexts have valid IDs', () => {
  for (const [code, ctx] of Object.entries(DOWNLOAD_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.categoryId) {
      assert(
        (SUPPORT_CATEGORY_IDS as readonly string[]).includes(ctx.categoryId),
        `DOWNLOAD_ERROR_SUPPORT_CONTEXT[${code}].categoryId invalid: ${ctx.categoryId}`,
      );
    }
    if (ctx.faqId) {
      assert(
        (SUPPORT_FAQ_IDS as readonly string[]).includes(ctx.faqId),
        `DOWNLOAD_ERROR_SUPPORT_CONTEXT[${code}].faqId invalid: ${ctx.faqId}`,
      );
    }
    if (ctx.reportCategory) {
      assert(
        (REPORT_CATEGORY_IDS as readonly string[]).includes(ctx.reportCategory),
        `DOWNLOAD_ERROR_SUPPORT_CONTEXT[${code}].reportCategory invalid: ${ctx.reportCategory}`,
      );
    }
  }
});

// 10. FILE_UNAVAILABLE_SUPPORT_CONTEXT validity
await test('FILE_UNAVAILABLE_SUPPORT_CONTEXT — valid IDs', () => {
  assert(
    (SUPPORT_CATEGORY_IDS as readonly string[]).includes(
      FILE_UNAVAILABLE_SUPPORT_CONTEXT.categoryId!,
    ),
    'FILE_UNAVAILABLE_SUPPORT_CONTEXT categoryId invalid',
  );
  assert(
    (SUPPORT_FAQ_IDS as readonly string[]).includes(FILE_UNAVAILABLE_SUPPORT_CONTEXT.faqId!),
    'FILE_UNAVAILABLE_SUPPORT_CONTEXT faqId invalid',
  );
});

// 11. hasSupportContext utility
await test('hasSupportContext — returns true when any field present', () => {
  assert(hasSupportContext({ categoryId: 'downloads' }), 'categoryId not detected');
  assert(hasSupportContext({ faqId: 'download-failed' }), 'faqId not detected');
  assert(hasSupportContext({ reportCategory: 'download' }), 'reportCategory not detected');
  assert(hasSupportContext({ source: 'test' }), 'source not detected');
  assert(!hasSupportContext({}), 'empty context should return false');
});

// 12. SupportScreen accepts initialContext prop
await test('SupportScreen — accepts initialContext prop', () => {
  const screen = readSrc('src/screens/support/SupportScreen.tsx');
  assert(screen.includes('initialContext'), 'SupportScreen missing initialContext prop');
  assert(screen.includes('SupportContext'), 'SupportScreen missing SupportContext type');
  assert(
    screen.includes('initialContext?.categoryId'),
    'SupportScreen not using initialContext.categoryId',
  );
  assert(
    screen.includes('initialContext?.faqId'),
    'SupportScreen not using initialContext.faqId',
  );
});

// 13. ReportProblemScreen accepts initialCategory + initialSource props
await test('ReportProblemScreen — accepts initialCategory + initialSource props', () => {
  const screen = readSrc('src/screens/support/ReportProblemScreen.tsx');
  assert(screen.includes('initialCategory'), 'ReportProblemScreen missing initialCategory');
  assert(screen.includes('initialSource'), 'ReportProblemScreen missing initialSource');
  assert(
    screen.includes('initialCategory') && screen.includes('category: initialCategory'),
    'ReportProblemScreen not applying initialCategory to draft',
  );
});

// 14. support.tsx route reads params and passes context
await test('support.tsx route — reads params and passes initialContext', () => {
  const route = readSrc('src/app/(app)/support.tsx');
  assert(route.includes('useLocalSearchParams'), 'route missing useLocalSearchParams');
  assert(route.includes('parseSupportContextParams'), 'route missing parseSupportContextParams');
  assert(route.includes('initialContext'), 'route missing initialContext prop pass');
});

// 15. report-problem.tsx route reads params and passes prefill
await test('report-problem.tsx route — reads params and passes prefill', () => {
  const route = readSrc('src/app/(app)/report-problem.tsx');
  assert(route.includes('useLocalSearchParams'), 'report route missing useLocalSearchParams');
  assert(route.includes('parseSupportContextParams'), 'report route missing parseSupportContextParams');
  assert(route.includes('initialCategory'), 'report route missing initialCategory');
  assert(route.includes('initialSource'), 'report route missing initialSource');
});

// 16. Player screen — Get Help button added for error state
await test('PlayerScreen — Get Help button in error state', () => {
  const screen = readSrc('src/screens/player/PlayerScreen.tsx');
  assert(screen.includes('support.getHelp'), 'PlayerScreen missing support.getHelp key');
  assert(
    screen.includes('openSupportWithContext'),
    'PlayerScreen missing openSupportWithContext call',
  );
  assert(
    screen.includes('getPlayerSupportContext'),
    'PlayerScreen missing getPlayerSupportContext',
  );
  assert(
    screen.includes('support.getHelpA11y'),
    'PlayerScreen missing support.getHelpA11y accessibility label',
  );
  assert(
    screen.includes('support.getHelpHint'),
    'PlayerScreen missing support.getHelpHint accessibility hint',
  );
});

// 17. Player screen — Get Help is AFTER Go Back (secondary, not primary)
await test('PlayerScreen — Get Help is secondary (appears after Go Back)', () => {
  const screen = readSrc('src/screens/player/PlayerScreen.tsx');
  const goBackIdx = screen.indexOf("t('common.goBack')");
  const getHelpIdx = screen.indexOf("t('support.getHelp')");
  assert(goBackIdx >= 0, 'goBack button not found');
  assert(getHelpIdx >= 0, 'getHelp button not found');
  assert(getHelpIdx > goBackIdx, 'Get Help must appear after Go Back in player error state');
});

// 18. DownloadDetailsScreen — Get Help in FAILED banner
await test('DownloadDetailsScreen — Get Help in failure banner', () => {
  const screen = readSrc('src/screens/downloads/DownloadDetailsScreen.tsx');
  assert(screen.includes('support.getHelp'), 'DownloadDetailsScreen missing support.getHelp');
  assert(
    screen.includes('getDownloadSupportContext'),
    'DownloadDetailsScreen missing getDownloadSupportContext',
  );
  assert(
    screen.includes('openSupportWithContext'),
    'DownloadDetailsScreen missing openSupportWithContext',
  );
});

// 19. DownloadDetailsScreen — Get Help in file-unavailable block
await test('DownloadDetailsScreen — Get Help in file-unavailable block', () => {
  const screen = readSrc('src/screens/downloads/DownloadDetailsScreen.tsx');
  assert(
    screen.includes('FILE_UNAVAILABLE_SUPPORT_CONTEXT'),
    'DownloadDetailsScreen missing FILE_UNAVAILABLE_SUPPORT_CONTEXT',
  );
});

// 20. Security: no sensitive data in params or context values
await test('Security — player context source labels contain no sensitive patterns', () => {
  const sensitivePatterns = [
    /https?:\/\//i,
    /file:\/\//i,
    /token/i,
    /password/i,
    /secret/i,
    /api_key/i,
    /authorization/i,
  ];
  for (const [code, ctx] of Object.entries(PLAYER_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.source) {
      for (const pat of sensitivePatterns) {
        assert(
          !pat.test(ctx.source),
          `PLAYER_ERROR_SUPPORT_CONTEXT[${code}].source has sensitive pattern: ${ctx.source}`,
        );
      }
    }
  }
});

await test('Security — download context source labels contain no sensitive patterns', () => {
  const sensitivePatterns = [
    /https?:\/\//i,
    /file:\/\//i,
    /token/i,
    /password/i,
    /secret/i,
  ];
  for (const [code, ctx] of Object.entries(DOWNLOAD_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.source) {
      for (const pat of sensitivePatterns) {
        assert(
          !pat.test(ctx.source),
          `DOWNLOAD_ERROR_SUPPORT_CONTEXT[${code}].source has sensitive pattern: ${ctx.source}`,
        );
      }
    }
  }
});

await test('Security — support-context.ts does not serialize raw errors', () => {
  const src = readSrc('src/support/support-context.ts');
  const lines = src.split('\n').filter(
    (l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
  );
  const code = lines.join('\n');
  // Must never pass error objects, only string codes looked up in maps
  assert(!code.includes('error.message'), 'support-context serializes error.message');
  assert(!code.includes('error.stack'), 'support-context serializes error.stack');
  assert(!code.includes('JSON.stringify(error'), 'support-context JSON.stringifies error');
});

// 21. Localization — EN keys present
await test('EN — support.getHelp key present', () => {
  assert(hasEnKey('support.getHelp'), 'support.getHelp missing from EN');
});

await test('EN — support.getHelpA11y key present', () => {
  assert(hasEnKey('support.getHelpA11y'), 'support.getHelpA11y missing from EN');
});

await test('EN — support.getHelpHint key present', () => {
  assert(hasEnKey('support.getHelpHint'), 'support.getHelpHint missing from EN');
});

await test('EN — downloads.fileUnavailableTitle present', () => {
  assert(hasEnKey('downloads.fileUnavailableTitle'), 'downloads.fileUnavailableTitle missing from EN');
});

// 22. Localization — UR keys present (parity)
await test('UR — support.getHelp key present', () => {
  assert(hasUrKey('support.getHelp'), 'support.getHelp missing from UR');
});

await test('UR — support.getHelpA11y key present', () => {
  assert(hasUrKey('support.getHelpA11y'), 'support.getHelpA11y missing from UR');
});

await test('UR — support.getHelpHint key present', () => {
  assert(hasUrKey('support.getHelpHint'), 'support.getHelpHint missing from UR');
});

await test('UR — downloads.fileUnavailableTitle present', () => {
  assert(hasUrKey('downloads.fileUnavailableTitle'), 'downloads.fileUnavailableTitle missing from UR');
});

// 23. No duplicate screens (no second support screen/route)
await test('No duplicate support screen route', () => {
  const appLayout = readSrc('src/app/(app)/_layout.tsx');
  const supportCount = (appLayout.match(/name.*support/g) ?? []).length;
  assert(supportCount <= 1, `multiple support route names in _layout: ${supportCount}`);
});

// 24. Architecture: support-context does not import react-native
await test('support-context.ts — no react-native import (Node-safe)', () => {
  const src = readSrc('src/support/support-context.ts');
  assert(
    !src.includes("from 'react-native'"),
    'support-context.ts must not import react-native',
  );
  assert(
    !src.includes("from 'expo-device'"),
    'support-context.ts must not import expo-device',
  );
});

// 25. Navigation freeze: route paths for support and report-problem exist (file inspection)
await test('Route paths: support and report-problem are defined', () => {
  const routePathsSrc = readSrc('src/navigation/constants/route-paths.ts');
  assert(routePathsSrc.includes('support'), 'routePaths.support missing');
  assert(routePathsSrc.includes('reportProblem'), 'routePaths.reportProblem missing');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${passed}/${total} tests passed`);

  if (failed > 0) {
    console.log(`${failed} test(s) failed.`);
    process.exit(1);
  }

  console.log('Phase 4B.2 verification complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
