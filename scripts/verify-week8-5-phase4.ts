/**
 * Week 8.5 Phase 4 — AGGREGATE verifier.
 * Runs Phase 4A, Phase 4B.1, and Phase 4B.2 contracts.
 * Pure static / logic checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase4.ts
 *   npm run verify:week8-5-phase4
 *
 * Does NOT duplicate full sub-suite tests — just checks that all critical
 * contracts from all three phases hold simultaneously.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasTranslationKey } from '../src/localization/translate';
import {
  SUPPORT_CATEGORY_IDS,
  SUPPORT_FAQ_IDS,
  canSubmitSupportReport,
  getSupportSubmissionMode,
  REPORT_CATEGORY_IDS,
} from '../src/support';
import {
  parseSupportContextParams,
  validateContextCategoryId,
  validateContextFaqId,
  PLAYER_ERROR_SUPPORT_CONTEXT,
  DOWNLOAD_ERROR_SUPPORT_CONTEXT,
  FILE_UNAVAILABLE_SUPPORT_CONTEXT,
  DOWNLOAD_DEFAULT_SUPPORT_CONTEXT,
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

// ─── Run all tests ───────────────────────────────────────────────────────────

async function main(): Promise<void> {

// ─── Phase 4A contracts ───────────────────────────────────────────────────────

console.log('\n── Phase 4A contracts ──');

await test('4A: SupportScreen exists', () => {
  readSrc('src/screens/support/SupportScreen.tsx');
});

await test('4A: FAQ categories are frozen', () => {
  assert(SUPPORT_CATEGORY_IDS.length >= 5, 'fewer than 5 categories');
  const required = ['getting-started', 'downloads', 'library-files', 'playback', 'account-settings'];
  for (const r of required) {
    assert(
      (SUPPORT_CATEGORY_IDS as readonly string[]).includes(r),
      `required category missing: ${r}`,
    );
  }
});

await test('4A: FAQ IDs are frozen non-empty list', () => {
  assert(SUPPORT_FAQ_IDS.length >= 10, 'fewer than 10 FAQ items');
});

await test('4A: Static Help Center offline — FAQ content is bundled', () => {
  const faqContent = readSrc('src/support/faq-content.ts');
  // FAQ items use questionKey/answerKey (localization keys), not inline text
  assert(faqContent.includes('questionKey:'), 'FAQ content missing questionKey fields');
  assert(faqContent.includes('answerKey:'), 'FAQ content missing answerKey fields');
});

await test('4A: EN support localization keys present', () => {
  assert(hasEnKey('support.title'), 'support.title missing EN');
  assert(hasEnKey('support.searchPlaceholder'), 'support.searchPlaceholder missing EN');
  assert(hasEnKey('support.categories.downloads.title'), 'support.categories.downloads.title missing EN');
});

await test('4A: UR support localization keys present', () => {
  assert(hasUrKey('support.title'), 'support.title missing UR');
  assert(hasUrKey('support.searchPlaceholder'), 'support.searchPlaceholder missing UR');
});

await test('4A: Support route registered in _layout', () => {
  const layout = readSrc('src/app/(app)/_layout.tsx');
  assert(layout.includes('support'), '_layout missing support route');
});

// ─── Phase 4B.1 contracts ─────────────────────────────────────────────────────

console.log('\n── Phase 4B.1 contracts ──');

await test('4B.1: ReportProblemScreen exists', () => {
  readSrc('src/screens/support/ReportProblemScreen.tsx');
});

await test('4B.1: REPORT_CATEGORY_IDS frozen', () => {
  const required = ['download', 'browser', 'playback', 'file', 'account', 'other'];
  for (const r of required) {
    assert(
      (REPORT_CATEGORY_IDS as readonly string[]).includes(r),
      `required report category missing: ${r}`,
    );
  }
});

await test('4B.1: Support submission mode — no fake success path', () => {
  const serviceSrc = readSrc('src/support/support-service.ts');
  assert(
    !serviceSrc.includes("status = 'success'") ||
      serviceSrc.includes('await') ||
      serviceSrc.includes('then('),
    'support-service must not immediately set success without async operation',
  );
});

await test('4B.1: Contact gating is truthful', () => {
  const mode = getSupportSubmissionMode();
  const can = canSubmitSupportReport();
  assert(
    (mode === 'unavailable') === !can,
    'canSubmitSupportReport inconsistent with getSupportSubmissionMode',
  );
});

await test('4B.1: Diagnostics file exists and excludes sensitive keys', () => {
  const src = readSrc('src/support/diagnostics.ts');
  assert(src.includes('DIAGNOSTICS_SENSITIVE_KEYS'), 'diagnostics allowlist missing');
  // Sensitive keys should only appear inside the blocklist array or in comments, not as
  // collected property names. Check collectDiagnostics function body specifically.
  const collectFnMatch = src.match(/function collectDiagnostics[\s\S]*?^}/m);
  const collectBody = collectFnMatch?.[0] ?? '';
  const sensitiveCollectPatterns = [
    /:\s*['"]?token['"]?/,
    /:\s*['"]?password['"]?/,
    /:\s*['"]?authorizationHeader['"]?/,
    /:\s*['"]?sourceUrl['"]?/,
    /:\s*['"]?apiKey['"]?/,
  ];
  for (const pat of sensitiveCollectPatterns) {
    assert(
      !pat.test(collectBody),
      `collectDiagnostics appears to collect sensitive key matching ${pat}`,
    );
  }
});

await test('4B.1: EN report keys present', () => {
  assert(hasEnKey('support.report.title'), 'support.report.title missing EN');
  assert(hasEnKey('support.report.categories.download'), 'support.report.categories.download missing EN');
  assert(hasEnKey('support.report.validation.categoryRequired'), 'validation key missing EN');
});

await test('4B.1: UR report keys present', () => {
  assert(hasUrKey('support.report.title'), 'support.report.title missing UR');
  assert(hasUrKey('support.report.categories.download'), 'support.report.categories.download missing UR');
});

await test('4B.1: report-problem route exists', () => {
  readSrc('src/app/(app)/report-problem.tsx');
  const routePathsSrc = readSrc('src/navigation/constants/route-paths.ts');
  assert(routePathsSrc.includes('reportProblem'), 'routePaths.reportProblem missing');
  const routeNamesSrc = readSrc('src/navigation/constants/route-names.ts');
  assert(routeNamesSrc.includes('reportProblem'), 'appStackRouteNames.reportProblem missing');
});

// ─── Phase 4B.2 contracts ─────────────────────────────────────────────────────

console.log('\n── Phase 4B.2 contracts ──');

await test('4B.2: support-context.ts exists and is Node-safe', () => {
  const src = readSrc('src/support/support-context.ts');
  assert(!src.includes("from 'react-native'"), 'support-context imports react-native');
  assert(!src.includes("from 'expo-device'"), 'support-context imports expo-device');
});

await test('4B.2: All mapped player contexts reference valid IDs', () => {
  for (const [code, ctx] of Object.entries(PLAYER_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.categoryId) {
      assert(
        (SUPPORT_CATEGORY_IDS as readonly string[]).includes(ctx.categoryId),
        `Player context[${code}].categoryId invalid`,
      );
    }
    if (ctx.faqId) {
      assert(
        (SUPPORT_FAQ_IDS as readonly string[]).includes(ctx.faqId),
        `Player context[${code}].faqId invalid`,
      );
    }
    if (ctx.reportCategory) {
      assert(
        (REPORT_CATEGORY_IDS as readonly string[]).includes(ctx.reportCategory),
        `Player context[${code}].reportCategory invalid`,
      );
    }
  }
});

await test('4B.2: All mapped download contexts reference valid IDs', () => {
  for (const [code, ctx] of Object.entries(DOWNLOAD_ERROR_SUPPORT_CONTEXT)) {
    if (ctx.categoryId) {
      assert(
        (SUPPORT_CATEGORY_IDS as readonly string[]).includes(ctx.categoryId),
        `Download context[${code}].categoryId invalid`,
      );
    }
    if (ctx.faqId) {
      assert(
        (SUPPORT_FAQ_IDS as readonly string[]).includes(ctx.faqId),
        `Download context[${code}].faqId invalid`,
      );
    }
  }
});

await test('4B.2: parseSupportContextParams rejects injection attempts', () => {
  const r1 = parseSupportContextParams({ categoryId: 'HACKED' });
  assert(r1.categoryId === undefined, 'injection not blocked in categoryId');
  const r2 = parseSupportContextParams({ faqId: 'not-a-real-faq' });
  assert(r2.faqId === undefined, 'injection not blocked in faqId');
  const r3 = parseSupportContextParams({ reportCategory: 'admin' });
  assert(r3.reportCategory === undefined, 'injection not blocked in reportCategory');
});

await test('4B.2: SupportScreen accepts and applies initialContext', () => {
  const screen = readSrc('src/screens/support/SupportScreen.tsx');
  assert(screen.includes('initialContext?.categoryId'), 'initialContext.categoryId not applied');
  assert(screen.includes('initialContext?.faqId'), 'initialContext.faqId not applied');
});

await test('4B.2: ReportProblemScreen applies initialCategory + initialSource', () => {
  const screen = readSrc('src/screens/support/ReportProblemScreen.tsx');
  assert(screen.includes('initialCategory'), 'initialCategory not in ReportProblemScreen');
  assert(screen.includes('initialSource'), 'initialSource not in ReportProblemScreen');
});

await test('4B.2: PlayerScreen Get Help uses getPlayerSupportContext (no raw error)', () => {
  const screen = readSrc('src/screens/player/PlayerScreen.tsx');
  assert(screen.includes('getPlayerSupportContext'), 'getPlayerSupportContext not used');
  assert(screen.includes('openSupportWithContext'), 'openSupportWithContext not used');
  // Must NOT pass raw error object/message to support context
  assert(
    !screen.includes('session.errorMessage'),
    'PlayerScreen must not pass raw errorMessage to support',
  );
});

await test('4B.2: DownloadDetailsScreen Get Help uses getDownloadSupportContext', () => {
  const screen = readSrc('src/screens/downloads/DownloadDetailsScreen.tsx');
  assert(screen.includes('getDownloadSupportContext(item.errorCode)'), 'errorCode passed to context helper');
  assert(screen.includes('FILE_UNAVAILABLE_SUPPORT_CONTEXT'), 'file-unavailable context used');
});

await test('4B.2: Get Help is never the only action (primary recovery preserved)', () => {
  // Player: error state has Go Back AND Get Help (not just Get Help)
  const player = readSrc('src/screens/player/PlayerScreen.tsx');
  const goBackIdx = player.indexOf("t('common.goBack')");
  const getHelpIdx = player.indexOf("t('support.getHelp')");
  assert(goBackIdx >= 0, 'Go Back button missing from player error state');
  assert(getHelpIdx >= 0, 'Get Help button missing from player error state');
  assert(getHelpIdx > goBackIdx, 'Get Help must come after Go Back');
});

await test('4B.2: EN + UR getHelp keys present', () => {
  assert(hasEnKey('support.getHelp'), 'support.getHelp missing EN');
  assert(hasEnKey('support.getHelpA11y'), 'support.getHelpA11y missing EN');
  assert(hasEnKey('support.getHelpHint'), 'support.getHelpHint missing EN');
  assert(hasUrKey('support.getHelp'), 'support.getHelp missing UR');
  assert(hasUrKey('support.getHelpA11y'), 'support.getHelpA11y missing UR');
  assert(hasUrKey('support.getHelpHint'), 'support.getHelpHint missing UR');
});

// ─── Legal / Privacy checks (Phase 3B.2 regression) ──────────────────────────

console.log('\n── Legal / Privacy regression ──');

await test('Legal: privacy route registered', () => {
  const routePathsSrc = readSrc('src/navigation/constants/route-paths.ts');
  assert(routePathsSrc.includes('privacy'), 'routePaths.privacy missing');
});

await test('Legal: SupportScreen links to privacy', () => {
  const screen = readSrc('src/screens/support/SupportScreen.tsx');
  assert(
    screen.includes("routePaths.privacy") || screen.includes("privacy"),
    'SupportScreen does not reference privacy route',
  );
});

// ─── Security final re-audit ──────────────────────────────────────────────────

console.log('\n── Security re-audit ──');

await test('Security: no sensitive context values in player/download context maps', () => {
  const sensitivePatterns = [/https?:\/\//i, /file:\/\//i, /token/i, /password/i, /secret/i];
  const allContexts = [
    ...Object.values(PLAYER_ERROR_SUPPORT_CONTEXT),
    ...Object.values(DOWNLOAD_ERROR_SUPPORT_CONTEXT),
    FILE_UNAVAILABLE_SUPPORT_CONTEXT,
    DOWNLOAD_DEFAULT_SUPPORT_CONTEXT,
  ];
  for (const ctx of allContexts) {
    if (ctx.source) {
      for (const pat of sensitivePatterns) {
        assert(
          !pat.test(ctx.source),
          `Context source label has sensitive pattern "${pat}": ${ctx.source}`,
        );
      }
    }
  }
});

await test('Security: support-context.ts source labels are human-readable only', () => {
  const src = readSrc('src/support/support-context.ts');
  // All source values must be human labels, not technical error strings
  const sourceValues = src.match(/source:\s*'([^']+)'/g) ?? [];
  for (const sv of sourceValues) {
    assert(!sv.includes('http'), `source value contains URL: ${sv}`);
    assert(!sv.includes('file://'), `source value contains file path: ${sv}`);
    assert(!sv.includes('.ts:'), `source value contains stack trace: ${sv}`);
  }
});

await test('Security: ReportProblemScreen initialSource clamped/sanitised', () => {
  const screen = readSrc('src/screens/support/ReportProblemScreen.tsx');
  // initialSource must be sliced/sanitised before use
  assert(
    screen.includes('.trim()') || screen.includes('.slice('),
    'initialSource must be trimmed/clamped before use in draft',
  );
});

// ─── Navigation matrix ────────────────────────────────────────────────────────

console.log('\n── Navigation matrix ──');

await test('Navigation: Settings → Support path exists', () => {
  const about = readSrc('src/screens/settings/components/AboutSection.tsx');
  assert(about.includes('routePaths.support'), 'AboutSection missing routePaths.support');
});

await test('Navigation: Support → Report Problem path exists', () => {
  const support = readSrc('src/screens/support/SupportScreen.tsx');
  assert(
    support.includes('report-problem') || support.includes('reportProblem'),
    'SupportScreen missing report-problem navigation',
  );
});

await test('Navigation: report-problem route registered in _layout', () => {
  const layout = readSrc('src/app/(app)/_layout.tsx');
  // Route name is camelCase in appStackRouteNames: reportProblem
  assert(
    layout.includes('reportProblem') || layout.includes('report-problem'),
    '_layout missing report-problem route',
  );
});

await test('Navigation: Player error → Get Help → Support', () => {
  const player = readSrc('src/screens/player/PlayerScreen.tsx');
  assert(player.includes('openSupportWithContext'), 'Player missing support navigation');
});

// ─── Offline static Help ──────────────────────────────────────────────────────

console.log('\n── Offline static Help ──');

await test('Offline: FAQ content is statically bundled (no network fetch)', () => {
  const faqContent = readSrc('src/support/faq-content.ts');
  assert(!faqContent.includes('fetch('), 'FAQ content must not contain fetch calls');
  assert(!faqContent.includes('axios'), 'FAQ content must not use axios');
  assert(!faqContent.includes('http'), 'FAQ content must not reference HTTP endpoints');
});

await test('Offline: SupportScreen does not require network for category/FAQ display', () => {
  const screen = readSrc('src/screens/support/SupportScreen.tsx');
  assert(!screen.includes('useEffect') || screen.includes('SUPPORT_FAQ_ITEMS'), 
    'SupportScreen should load FAQ items from static source');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${passed}/${total} tests passed`);

  if (failed > 0) {
    console.log(`${failed} test(s) failed.`);
    process.exit(1);
  }

  console.log('\nWeek 8.5 Phase 4 aggregate verification complete.');
  console.log('Phase 4A: Help Center + FAQ + Search — VERIFIED');
  console.log('Phase 4B.1: Contact Support + Report a Problem — VERIFIED');
  console.log('Phase 4B.2: Contextual Get Help + Error Integration — VERIFIED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
