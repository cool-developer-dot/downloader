/**
 * Week 8.5 Phase 3B.2 — Privacy/Terms UI + Legal navigation & integration.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase3b2.ts
 *   npm run verify:week8-5-phase3b2
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isLegalContactConfigured,
  isPublicLegalWebOpenable,
  legalConfig,
  privacyDocument,
  termsDocument,
} from '../src/legal';
import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { hasTranslationKey } from '../src/localization/translate';
import { routePaths } from '../src/navigation/constants/route-paths';

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

function readSrc(relFromMobile: string): string {
  return readFileSync(join(ROOT, relFromMobile), 'utf8');
}

const SETTINGS_LEGAL_KEYS = [
  'settings.legalSection',
  'settings.legalDescription',
  'settings.privacyPolicy',
  'settings.privacyHint',
  'settings.privacyA11y',
  'settings.termsConditions',
  'settings.termsHint',
  'settings.termsA11y',
  'settings.aboutApp',
  'settings.helpAccountSection',
  'legal.footer.supportTitle',
  'support.privacyQuestions',
  'support.deletionRequest',
] as const;

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /coming soon/i,
  /future release/i,
  /will be implemented/i,
  /does not add new legal promises/i,
  // Ignore JSX `placeholder={...}` props; catch user-visible copy only.
  /(?<![\w.])placeholder(?!\s*=)/i,
];

async function main(): Promise<void> {
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);
  const privacyScreen = readSrc('src/screens/legal/PrivacyScreen.tsx');
  const termsScreen = readSrc('src/screens/legal/TermsScreen.tsx');
  const documentView = readSrc('src/screens/legal/LegalDocumentView.tsx');
  const header = readSrc('src/screens/legal/document/LegalDocumentHeader.tsx');
  const footer = readSrc('src/screens/legal/document/LegalFooterActions.tsx');
  const sectionBlock = readSrc('src/screens/legal/document/LegalSectionBlock.tsx');
  const settingsScreen = readSrc('src/screens/settings/SettingsScreen.tsx');
  const legalSection = readSrc('src/screens/settings/components/LegalSection.tsx');
  const aboutSection = readSrc('src/screens/settings/components/AboutSection.tsx');
  const aboutScreen = readSrc('src/screens/legal/AboutScreen.tsx');
  const supportScreen = readSrc('src/screens/support/SupportScreen.tsx');
  const supportPrivacy = readSrc(
    'src/screens/support/components/SupportPrivacySection.tsx',
  );
  const supportLegalBridge = readSrc('src/screens/legal/SupportScreen.tsx');
  const privacyRoute = readSrc('src/app/(app)/privacy.tsx');
  const termsRoute = readSrc('src/app/(app)/terms.tsx');
  const packageJson = readSrc('package.json');

  await test('Privacy and Terms routes exist', () => {
    assert(privacyRoute.includes('PrivacyScreen'), 'privacy route');
    assert(termsRoute.includes('TermsScreen'), 'terms route');
    assert(routePaths.privacy === '/privacy', 'privacy path');
    assert(routePaths.terms === '/terms', 'terms path');
    assert(routePaths.about === '/about', 'about path');
    assert(routePaths.support === '/support', 'support path');
    assert(routePaths.settings === '/settings', 'settings path');
  });

  await test('Settings Legal links are correct', () => {
    assert(settingsScreen.includes('LegalSection'), 'Settings mounts LegalSection');
    assert(legalSection.includes('routePaths.privacy'), 'Legal → Privacy');
    assert(legalSection.includes('routePaths.terms'), 'Legal → Terms');
    assert(legalSection.includes('routePaths.about'), 'Legal → About');
    assert(
      !legalSection.includes("t('about.openSourceLicenses')") &&
        !legalSection.includes('openSourceLicenses'),
      'no licenses row without destination',
    );
    assert(
      !aboutSection.includes('routePaths.about'),
      'About row moved out of Support section',
    );
    assert(aboutSection.includes('routePaths.support'), 'Support section keeps Help');
  });

  await test('About legal links preserved', () => {
    assert(aboutScreen.includes('routePaths.support'), 'About → Support');
    assert(aboutScreen.includes('routePaths.privacy'), 'About → Privacy');
    assert(aboutScreen.includes('routePaths.terms'), 'About → Terms');
    assert(!aboutScreen.includes('privacyDocument'), 'About does not embed privacy doc');
    assert(!aboutScreen.includes('termsDocument'), 'About does not embed terms doc');
  });

  await test('Shared legal renderer / source used', () => {
    assert(privacyScreen.includes('privacyDocument'), 'Privacy uses privacyDocument');
    assert(termsScreen.includes('termsDocument'), 'Terms uses termsDocument');
    assert(privacyScreen.includes('LegalDocumentView'), 'Privacy uses shared view');
    assert(termsScreen.includes('LegalDocumentView'), 'Terms uses shared view');
    assert(documentView.includes('LegalDocumentHeader'), 'uses header component');
    assert(documentView.includes('LegalSectionBlock'), 'uses section component');
    assert(documentView.includes('LegalFooterActions'), 'uses footer actions');
    assert(documentView.includes('document.sections'), 'walks structured sections');
    assert(privacyDocument.id === 'privacy', 'privacy source id');
    assert(termsDocument.id === 'terms', 'terms source id');
  });

  await test('EN/UR keys exist for UI chrome', () => {
    for (const key of SETTINGS_LEGAL_KEYS) {
      assert(hasTranslationKey(key, 'en'), `missing EN ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR ${key}`);
      assert(enFlat[key]?.trim().length, `empty EN ${key}`);
      assert(urFlat[key]?.trim().length, `empty UR ${key}`);
    }
  });

  await test('No placeholder legal UI copy', () => {
    const sources = [
      privacyScreen,
      termsScreen,
      documentView,
      header,
      footer,
      supportScreen,
      supportPrivacy,
      legalSection,
    ];
    for (const src of sources) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(src), `placeholder ${pattern} in legal UI source`);
      }
    }
    for (const key of [
      'support.description',
      'legal.footer.supportDescription',
      'settings.legalDescription',
    ]) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(enFlat[key]!), `EN ${key} matched ${pattern}`);
        assert(!pattern.test(urFlat[key]!), `UR ${key} matched ${pattern}`);
      }
    }
  });

  await test('No broken configured-contact / public-web links', () => {
    assert(!isLegalContactConfigured(), 'contact stays unconfigured until set');
    assert(!isPublicLegalWebOpenable(), 'public web must stay gated off');
    assert(legalConfig.publicWebPublished === false, 'publicWebPublished false');
    assert(footer.includes('isLegalContactConfigured'), 'footer gates contact');
    assert(footer.includes('isPublicLegalWebOpenable'), 'footer gates web');
    assert(footer.includes('mailto:'), 'mailto only behind contact gate');
    assert(
      !footer.includes('example.com') && !documentView.includes('example.com'),
      'no placeholder domains',
    );
    assert(
      supportScreen.includes('isLegalContactConfigured') ||
        supportPrivacy.includes('isLegalContactConfigured'),
      'Support gates email',
    );
    assert(
      !supportScreen.includes('createTicket') &&
        !supportScreen.includes('submitTicket') &&
        !supportPrivacy.includes('createTicket'),
      'no fake ticket submission',
    );
  });

  await test('Theme-token usage (no hardcoded screen palette)', () => {
    assert(header.includes('useTheme'), 'header theme');
    assert(sectionBlock.includes('useTheme'), 'section theme');
    assert(footer.includes('useTheme'), 'footer theme');
    assert(documentView.includes('useTheme'), 'document view theme');
    assert(supportScreen.includes('useTheme'), 'support theme');
    assert(supportPrivacy.includes('useTheme'), 'support privacy theme');
    assert(!documentView.includes('settingsTokens'), 'legal UI not locked to settingsTokens');
    assert(!header.includes('#F3F5F8'), 'no settings light-only bg hardcode');
    assert(!header.includes('#2563EB'), 'no hardcoded primary hex in header');
  });

  await test('No duplicate legal content embedded in screens', () => {
    assert(!privacyScreen.includes('sections.introduction'), 'PrivacyScreen no content keys tree');
    assert(
      !/"This Privacy Policy explains"/.test(privacyScreen),
      'PrivacyScreen must not embed policy prose',
    );
    assert(
      !/"These Terms & Conditions govern"/.test(termsScreen),
      'TermsScreen must not embed terms prose',
    );
    assert(privacyScreen.split('\n').length < 40, 'PrivacyScreen stays thin');
    assert(termsScreen.split('\n').length < 40, 'TermsScreen stays thin');
  });

  await test('Support integrates Privacy / deletion (Help Center may also be present)', () => {
    assert(
      supportLegalBridge.includes('@/screens/support') ||
        supportLegalBridge.includes('SupportScreen'),
      'legal Support bridge remains',
    );
    assert(
      supportScreen.includes('routePaths.privacy') ||
        supportPrivacy.includes('routePaths.privacy') ||
        supportScreen.includes('openPrivacy'),
      'Support → Privacy',
    );
    assert(
      supportScreen.includes('support.privacyQuestions') ||
        supportPrivacy.includes('support.privacyQuestions'),
      'privacy questions row',
    );
    assert(
      supportScreen.includes('support.deletionRequest') ||
        supportPrivacy.includes('support.deletionRequest'),
      'deletion info row',
    );
    assert(supportScreen.includes('useTranslation'), 'Support localized');
  });

  await test('npm script wired', () => {
    assert(packageJson.includes('verify:week8-5-phase3b2'), 'npm script missing');
  });

  console.log('');
  console.log(`Week 8.5 Phase 3B.2: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
