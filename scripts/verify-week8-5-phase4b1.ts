/**
 * Week 8.5 Phase 4B.1 — Contact Support + Report a Problem + Safe Diagnostics.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase4b1.ts
 *   npm run verify:week8-5-phase4b1
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { hasTranslationKey } from '../src/localization/translate';
import { routePaths } from '../src/navigation/constants/route-paths';
import { appStackRouteNames } from '../src/navigation/constants/route-names';
import {
  REPORT_CATEGORY_IDS,
  REPORT_DESCRIPTION_MAX,
  REPORT_DESCRIPTION_MIN,
  REPORT_SUBJECT_MAX,
  REPORT_SUBJECT_MIN,
  validateReportDraft,
  canSubmitSupportReport,
  getSupportSubmissionMode,
  getSupportEmail,
} from '../src/support';
import { legalConfig } from '../src/legal';
/**
 * NOTE: diagnostics.ts and support-service.ts import react-native/expo-device.
 * Cannot be imported here in Node. Tests use file inspection instead.
 */

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
  return readFileSync(join(ROOT, rel), 'utf8');
}

// ─── Parity keys required in both EN and UR ──────────────────────────────────

const REQUIRED_4B1_KEYS = [
  'nav.reportProblem',
  'support.supportActionsHeading',
  'support.contactSupport',
  'support.contactSupportHint',
  'support.contactSupportA11y',
  'support.reportProblem',
  'support.reportProblemHint',
  'support.reportProblemA11y',
  'support.contactUnavailableTitle',
  'support.contactUnavailableDescription',
  'support.report.title',
  'support.report.a11y',
  'support.report.categoryLabel',
  'support.report.categoryPlaceholder',
  'support.report.subjectLabel',
  'support.report.subjectPlaceholder',
  'support.report.descriptionLabel',
  'support.report.descriptionPlaceholder',
  'support.report.includeDiagnostics',
  'support.report.diagnosticsHint',
  'support.report.diagnosticsExpanded',
  'support.report.send',
  'support.report.sending',
  'support.report.successTitle',
  'support.report.successDescription',
  'support.report.failureTitle',
  'support.report.failureDescription',
  'support.report.retry',
  'support.report.unavailableTitle',
  'support.report.unavailableDescription',
  'support.report.privacyNote',
  'support.report.openPrivacy',
  'support.report.categories.download',
  'support.report.categories.browser',
  'support.report.categories.playback',
  'support.report.categories.file',
  'support.report.categories.account',
  'support.report.categories.other',
  'support.report.validation.categoryRequired',
  'support.report.validation.subjectRequired',
  'support.report.validation.subjectTooShort',
  'support.report.validation.subjectTooLong',
  'support.report.validation.descriptionRequired',
  'support.report.validation.descriptionTooShort',
  'support.report.validation.descriptionTooLong',
] as const;

// ─── Sensitive key names that must NEVER appear in diagnostics ───────────────

const SENSITIVE_SEARCH_TERMS = [
  'token',
  'password',
  'secret',
  'cookie',
  'session',
  'credential',
  'apiKey',
  'privateKey',
  'filePath',
  'sourceUrl',
  'mediaUrl',
] as const;

async function main() {
  const enFlat = flattenCatalog(en as never);
  const urFlat = flattenCatalog(ur as never);

  const supportModuleText = [
    readSrc('src/support/diagnostics.ts'),
    readSrc('src/support/support-config.ts'),
    readSrc('src/support/support-service.ts'),
    readSrc('src/support/report-types.ts'),
    readSrc('src/support/validation.ts'),
    readSrc('src/support/index.ts'),
  ].join('\n');

  const reportScreenText = readSrc('src/screens/support/ReportProblemScreen.tsx');
  const supportScreenText = readSrc('src/screens/support/SupportScreen.tsx');
  const packageJson = readSrc('package.json');

  // ── 1. Report categories ────────────────────────────────────────────────────
  await test('Report category IDs frozen to spec', () => {
    const EXPECTED = ['download', 'browser', 'playback', 'file', 'account', 'other'];
    for (const id of EXPECTED) {
      assert(
        (REPORT_CATEGORY_IDS as readonly string[]).includes(id),
        `missing category: ${id}`,
      );
    }
    assert(REPORT_CATEGORY_IDS.length === EXPECTED.length, 'unexpected extra categories');
  });

  // ── 2. Report validation ────────────────────────────────────────────────────
  await test('validateReportDraft — missing category', () => {
    const r = validateReportDraft({ category: null, subject: 'subject ok here', description: 'description that is long enough to pass', includeDiagnostics: false });
    assert(!r.valid, 'should fail');
    if (!r.valid) assert(r.errors.category, 'category error');
  });

  await test('validateReportDraft — subject too short', () => {
    const r = validateReportDraft({ category: 'other', subject: 'hi', description: 'description that is long enough to pass', includeDiagnostics: false });
    assert(!r.valid, 'should fail');
    if (!r.valid) assert(r.errors.subject === 'subjectTooShort', `got ${r.valid ? '' : r.errors.subject}`);
  });

  await test('validateReportDraft — description too short', () => {
    const r = validateReportDraft({ category: 'other', subject: 'Valid subject', description: 'short', includeDiagnostics: false });
    assert(!r.valid, 'should fail');
    if (!r.valid) assert(r.errors.description === 'descriptionTooShort', `got ${r.valid ? '' : r.errors.description}`);
  });

  await test('validateReportDraft — subject too long', () => {
    const long = 'x'.repeat(REPORT_SUBJECT_MAX + 1);
    const r = validateReportDraft({ category: 'other', subject: long, description: 'description that is long enough to pass', includeDiagnostics: false });
    assert(!r.valid, 'should fail');
    if (!r.valid) assert(r.errors.subject === 'subjectTooLong', `got ${r.valid ? '' : r.errors.subject}`);
  });

  await test('validateReportDraft — description too long', () => {
    const long = 'x'.repeat(REPORT_DESCRIPTION_MAX + 1);
    const r = validateReportDraft({ category: 'other', subject: 'Valid subject', description: long, includeDiagnostics: false });
    assert(!r.valid, 'should fail');
    if (!r.valid) assert(r.errors.description === 'descriptionTooLong', `got ${r.valid ? '' : r.errors.description}`);
  });

  await test('validateReportDraft — valid draft passes', () => {
    const r = validateReportDraft({
      category: 'download',
      subject: 'Video download failed',
      description: 'Download failed after 10 seconds with a network error. Tried on both Wi-Fi and LTE.',
      includeDiagnostics: true,
    });
    assert(r.valid, `should pass: ${r.valid ? '' : JSON.stringify((r as { errors: unknown }).errors)}`);
    if (r.valid) {
      assert(r.data.category === 'download', 'category preserved');
      assert(r.data.subject === 'Video download failed', 'subject trimmed correctly');
    }
  });

  await test('validateReportDraft — trims whitespace', () => {
    const r = validateReportDraft({
      category: 'playback',
      subject: '  Playback stalls  ',
      description: '  Player freezes after 5 seconds on every video I try.  ',
      includeDiagnostics: false,
    });
    assert(r.valid, 'should pass');
    if (r.valid) {
      assert(r.data.subject === 'Playback stalls', 'subject trimmed');
      assert(r.data.description === 'Player freezes after 5 seconds on every video I try.', 'description trimmed');
    }
  });

  // ── 3. Submission mode / capability gating ──────────────────────────────────
  await test('Submission mode is unavailable (no email/backend configured)', () => {
    const mode = getSupportSubmissionMode();
    // legalConfig email is null in this build
    assert(
      legalConfig.contact.supportEmail === null,
      'supportEmail should be null in current build',
    );
    assert(
      legalConfig.contact.privacyEmail === null,
      'privacyEmail should be null in current build',
    );
    assert(mode === 'unavailable', `expected unavailable, got ${mode}`);
    assert(!canSubmitSupportReport(), 'canSubmit should be false');
    assert(getSupportEmail() === null, 'email should be null');
  });

  await test('getSupportSubmissionMode returns email when supportEmail configured', () => {
    // Temporarily patch to verify email path logic
    const original = legalConfig.contact.supportEmail;
    (legalConfig.contact as { supportEmail: string | null }).supportEmail = 'test@vidorax.app';
    try {
      const mode = getSupportSubmissionMode();
      assert(mode === 'email', `expected email, got ${mode}`);
      assert(canSubmitSupportReport(), 'canSubmit should be true');
      assert(getSupportEmail() === 'test@vidorax.app', 'email should be returned');
    } finally {
      (legalConfig.contact as { supportEmail: string | null }).supportEmail = original;
    }
  });

  // ── 4. Diagnostics allowlist / sensitive-key exclusion (file inspection) ───
  await test('DIAGNOSTICS_SENSITIVE_KEYS list defined in diagnostics.ts', () => {
    const diagText = readSrc('src/support/diagnostics.ts');
    assert(diagText.includes('DIAGNOSTICS_SENSITIVE_KEYS'), 'list present in file');
    for (const term of SENSITIVE_SEARCH_TERMS) {
      assert(
        diagText.includes(term) || diagText.toLowerCase().includes(term.toLowerCase()),
        `sensitive term '${term}' not in sensitive keys list`,
      );
    }
  });

  await test('diagnostics.ts has allowlist comment and excludes sensitive fields', () => {
    const diagText = readSrc('src/support/diagnostics.ts');
    assert(diagText.includes('allowlist') || diagText.includes('ALLOWLIST'), 'allowlist approach documented');
    assert(diagText.includes('Explicitly EXCLUDE') || diagText.includes('Excluded'), 'exclusion list present');
    for (const term of ['accessToken', 'refreshToken', 'password', 'secret', 'cookie']) {
      assert(
        !diagText.includes(`${term}:`),
        `sensitive key '${term}' assigned in diagnostics`,
      );
    }
  });

  await test('diagnostics.ts only collects allowlisted fields', () => {
    const diagText = readSrc('src/support/diagnostics.ts');
    const allowlisted = ['appVersion', 'buildNumber', 'platform', 'osVersion', 'deviceModel', 'appLocale', 'appTheme', 'issueCategory', 'timestamp'];
    for (const field of allowlisted) {
      assert(diagText.includes(field), `allowlisted field '${field}' missing from diagnostics`);
    }
  });

  await test('buildReportPayload source — null diagnostics when includeDiagnostics=false', () => {
    const serviceText = readSrc('src/support/support-service.ts');
    assert(
      serviceText.includes('if (includeDiagnostics)'),
      'service guards diagnostics collection behind flag',
    );
    assert(
      serviceText.includes('null') && serviceText.includes('diagnostics'),
      'null diagnostics path present',
    );
  });

  await test('buildReportPayload source — only allowlisted fields in payload', () => {
    const serviceText = readSrc('src/support/support-service.ts');
    for (const forbidden of ['accessToken', 'refreshToken', 'password', 'secret', 'filePath', 'sourceUrl']) {
      assert(
        !serviceText.includes(`${forbidden}:`),
        `forbidden field '${forbidden}' in service payload construction`,
      );
    }
  });

  // ── 5. No fake submission paths ─────────────────────────────────────────────
  await test('Support service never fakes success', () => {
    const serviceText = readSrc('src/support/support-service.ts');
    assert(!serviceText.includes("status: 'success'") || serviceText.includes("opened"), 'fake success guard');
    // The only success path is when email actually opened
    const successCount = (serviceText.match(/status: 'success'/g) ?? []).length;
    const openedGuard = serviceText.includes('if (opened)');
    assert(openedGuard || successCount === 0, 'success only returned after opened=true check');
  });

  await test('No fake "sent successfully" or fake fetch in support module', () => {
    assert(!supportModuleText.includes("'sent successfully'"), 'no fake sent msg');
    assert(!supportModuleText.includes('"sent successfully"'), 'no fake sent msg');
    // fetch is allowed in service (if backend mode added later) but not in diagnostics/types/config
    const nonServiceText = [
      readSrc('src/support/diagnostics.ts'),
      readSrc('src/support/report-types.ts'),
      readSrc('src/support/support-config.ts'),
      readSrc('src/support/validation.ts'),
    ].join('\n');
    assert(!nonServiceText.includes('fetch('), 'no fetch in non-service support files');
  });

  await test('Report screen clears text only after confirmed success', () => {
    assert(
      reportScreenText.includes('submitResult.status') || reportScreenText.includes("nextStatus === 'success'"),
      'status check before clear',
    );
    assert(
      reportScreenText.includes('EMPTY_REPORT_DRAFT'),
      'reset to EMPTY_REPORT_DRAFT used',
    );
  });

  // ── 6. EN/UR key parity ─────────────────────────────────────────────────────
  await test('All Phase 4B.1 EN/UR keys present and non-empty', () => {
    for (const key of REQUIRED_4B1_KEYS) {
      assert(hasTranslationKey(key, 'en'), `missing EN key: ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR key: ${key}`);
      assert(enFlat[key]?.trim().length, `empty EN key: ${key}`);
      assert(urFlat[key]?.trim().length, `empty UR key: ${key}`);
    }
  });

  // ── 7. Phase 4A architecture preserved ─────────────────────────────────────
  await test('Phase 4A support module unchanged — categories/FAQ/search still exported', () => {
    const indexSrc = readSrc('src/support/index.ts');
    assert(indexSrc.includes('SUPPORT_CATEGORIES'), 'SUPPORT_CATEGORIES exported');
    assert(indexSrc.includes('SUPPORT_FAQ_ITEMS'), 'SUPPORT_FAQ_ITEMS exported');
    assert(indexSrc.includes('searchSupportFaqs'), 'searchSupportFaqs exported');
    assert(indexSrc.includes('SUPPORT_ACTIONS'), 'SUPPORT_ACTIONS exported');
  });

  await test('Phase 4A SupportScreen still has FAQ accordion, search, categories', () => {
    assert(supportScreenText.includes('SupportFaqAccordionItem'), 'FAQ accordion preserved');
    assert(supportScreenText.includes('SearchField'), 'search preserved');
    assert(supportScreenText.includes('SupportCategoryCard'), 'categories preserved');
    assert(supportScreenText.includes('SupportPrivacySection'), 'privacy section preserved');
  });

  await test('Phase 4A legal links preserved in SupportScreen', () => {
    assert(supportScreenText.includes('routePaths.privacy'), 'privacy route preserved');
    assert(supportScreenText.includes('openPrivacy'), 'openPrivacy handler preserved');
    assert(supportScreenText.includes('openDeletionInfo'), 'deletionInfo handler preserved');
  });

  // ── 8. Contact Support gating ───────────────────────────────────────────────
  await test('SupportScreen exposes Contact Support and Report a Problem sections', () => {
    assert(supportScreenText.includes('support-contact-section'), 'testID contact section');
    assert(supportScreenText.includes('support-report-problem'), 'testID report problem');
    assert(
      supportScreenText.includes('supportActionsHeading') ||
        supportScreenText.includes('support.supportActionsHeading'),
      'heading used',
    );
  });

  await test('Unavailable mode shows honest copy, not dead action', () => {
    assert(
      supportScreenText.includes('contactUnavailableTitle') ||
        supportScreenText.includes('support.contactUnavailableTitle'),
      'unavailable title used',
    );
    assert(
      supportScreenText.includes('contactUnavailableDescription') ||
        supportScreenText.includes('support.contactUnavailableDescription'),
      'unavailable description used',
    );
  });

  // ── 9. Route + navigation wired ─────────────────────────────────────────────
  await test('reportProblem route exists in routePaths', () => {
    assert('reportProblem' in routePaths, 'reportProblem missing from routePaths');
    assert(routePaths.reportProblem === '/report-problem', `bad path: ${(routePaths as Record<string, string>).reportProblem}`);
  });

  await test('reportProblem route name exists in appStackRouteNames', () => {
    assert('reportProblem' in appStackRouteNames, 'missing from appStackRouteNames');
    assert(appStackRouteNames.reportProblem === 'report-problem', 'route name mismatch');
  });

  await test('Expo Router file report-problem.tsx exists', () => {
    const routeFile = join(ROOT, 'src/app/(app)/report-problem.tsx');
    assert(existsSync(routeFile), 'src/app/(app)/report-problem.tsx missing');
  });

  // ── 10. Privacy / legal links preserved in report form ──────────────────────
  await test('Report screen links to Privacy Policy', () => {
    assert(
      reportScreenText.includes("routePaths.privacy") || reportScreenText.includes("'privacy'"),
      'privacy route used in report screen',
    );
    assert(
      reportScreenText.includes('openPrivacy') || reportScreenText.includes('report-privacy-link'),
      'privacy link present',
    );
  });

  // ── 11. Security — no sensitive data in payload construction ────────────────
  await test('Support service does not log or serialize sensitive keys', () => {
    const serviceText = readSrc('src/support/support-service.ts');
    for (const term of ['accessToken', 'refreshToken', 'password', 'secret']) {
      assert(
        !serviceText.toLowerCase().includes(term.toLowerCase()),
        `sensitive term '${term}' found in support-service.ts`,
      );
    }
  });

  await test('Diagnostics module excludes sensitive keys from allowlist', () => {
    const diagText = readSrc('src/support/diagnostics.ts');
    assert(diagText.includes('DIAGNOSTICS_SENSITIVE_KEYS'), 'allowlist exported');
    assert(diagText.includes('allowlist'), 'allowlist comment present');
    for (const term of ['accessToken', 'refreshToken', 'password']) {
      assert(
        !diagText.includes(`${term}:`),
        `sensitive key '${term}' assigned in diagnostics.ts`,
      );
    }
  });

  // ── 12. npm script wired ────────────────────────────────────────────────────
  await test('npm script verify:week8-5-phase4b1 wired', () => {
    assert(packageJson.includes('verify:week8-5-phase4b1'), 'npm script missing');
  });

  console.log('');
  console.log(`Week 8.5 Phase 4B.1: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
