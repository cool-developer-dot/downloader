/**
 * Week 8.5 Phase 3B.1 — Shared legal architecture + Privacy/Terms content.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase3b1.ts
 *   npm run verify:week8-5-phase3b1
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectLegalDocumentKeys,
  getConfiguredLegalContactEmail,
  isLegalContactConfigured,
  legalConfig,
  legalDocuments,
  privacyDocument,
  termsDocument,
} from '../src/legal';
import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { hasTranslationKey } from '../src/localization/translate';

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

const PRIVACY_REQUIRED_SECTION_IDS = [
  'introduction',
  'information-processed',
  'how-used',
  'backend-communication',
  'third-parties',
  'local-storage',
  'retention',
  'security',
  'user-controls',
  'account-deletion',
  'children',
  'updates',
  'contact',
] as const;

const TERMS_REQUIRED_SECTION_IDS = [
  'acceptance',
  'permitted-use',
  'content-ownership',
  'user-authorization',
  'supported-sources',
  'drm-limitations',
  'user-responsibilities',
  'prohibited-misuse',
  'service-availability',
  'accounts-security',
  'local-files',
  'device-limitations',
  'limitation-of-service',
  'suspension',
  'updates',
  'contact',
] as const;

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bplaceholder\b/i,
  /\[insert\b/i,
  /TBD\b/,
  /coming soon/i,
  /will be published as the product is finalized/i,
  /does not add new legal promises/i,
];

const PERSONAL_EMAIL_PATTERNS = [
  /@gmail\.com/i,
  /@yahoo\./i,
  /@hotmail\./i,
  /@outlook\./i,
  /@icloud\.com/i,
  /@me\.com/i,
  /@proton\.me/i,
  /mac@/i,
];

const SECRET_INFRA_PATTERNS = [
  /api\.vidorax\.com/i,
  /localhost:\d+/i,
  /EXPO_PUBLIC_/i,
  /passwordHash/i,
  /DATABASE_URL/i,
  /SUPABASE_SERVICE/i,
  /JWT_SECRET/i,
  /prisma/i,
  /postgresql:\/\//i,
];

const ABSOLUTE_SECURITY_PATTERNS = [
  /\bwe never share\b/i,
  /\bnever share (?:your |any )?data\b/i,
  /\bis completely secure\b/i,
  /\bare completely secure\b/i,
  /\b100%\s*secure\b/i,
  /\bperfect(?:ly)? secure\b/i,
  /\bmilitary[- ]grade\b/i,
  /\bguaranteed(?:ly)? encrypted\b/i,
  /\bimpossible to (?:hack|breach)\b/i,
];

const META_KEYS = [
  'legal.effectiveLabel',
  'legal.updatedLabel',
  'legal.listBullet',
  'privacy.a11y',
  'terms.a11y',
] as const;

async function main(): Promise<void> {
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);
  const configSrc = readSrc('src/legal/config.ts');
  const typesSrc = readSrc('src/legal/types.ts');
  const privacyContentSrc = readSrc('src/legal/privacy-content.ts');
  const termsContentSrc = readSrc('src/legal/terms-content.ts');
  const indexSrc = readSrc('src/legal/index.ts');
  const privacyScreen = readSrc('src/screens/legal/PrivacyScreen.tsx');
  const termsScreen = readSrc('src/screens/legal/TermsScreen.tsx');
  const documentView = readSrc('src/screens/legal/LegalDocumentView.tsx');
  const packageJson = readSrc('package.json');

  const allLegalCopy = [
    ...Object.values(enFlat).filter((v) =>
      Object.keys(enFlat).some(
        (k) =>
          (k.startsWith('privacy.') ||
            k.startsWith('terms.') ||
            k.startsWith('legal.')) &&
          enFlat[k] === v,
      ),
    ),
  ].join('\n');

  const privacyKeys = collectLegalDocumentKeys(privacyDocument);
  const termsKeys = collectLegalDocumentKeys(termsDocument);
  const allDocKeys = [...privacyKeys, ...termsKeys, ...META_KEYS];

  await test('Legal module files exist with shared exports', () => {
    assert(configSrc.includes('legalConfig'), 'config missing legalConfig');
    assert(typesSrc.includes('LegalDocument'), 'types missing LegalDocument');
    assert(privacyContentSrc.includes('privacyDocument'), 'privacy content');
    assert(termsContentSrc.includes('termsDocument'), 'terms content');
    assert(indexSrc.includes('getLegalDocument'), 'index must export getter');
    assert(indexSrc.includes('legalDocuments'), 'index must export map');
    assert(legalDocuments.privacy === privacyDocument, 'privacy map wiring');
    assert(legalDocuments.terms === termsDocument, 'terms map wiring');
  });

  await test('Legal config centralizes product, dates, URLs, contact state', () => {
    assert(legalConfig.productName === 'VidoraX', 'product name');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(legalConfig.effectiveDate), 'effective ISO');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(legalConfig.updatedDate), 'updated ISO');
    assert(
      legalConfig.publicPrivacyUrl === 'https://vidorax.app/privacy',
      'public privacy URL',
    );
    assert(
      legalConfig.publicTermsUrl === 'https://vidorax.app/terms',
      'public terms URL',
    );
    assert(legalConfig.websiteOrigin === 'https://vidorax.app', 'website origin');
    assert(legalConfig.contact.privacyEmail === null, 'privacy email must be null until configured');
    assert(legalConfig.contact.supportEmail === null, 'support email must be null until configured');
    assert(!isLegalContactConfigured(), 'contact must report unconfigured');
    assert(getConfiguredLegalContactEmail() === null, 'no invented contact email');
  });

  await test('Privacy required sections present', () => {
    const ids = privacyDocument.sections.map((s) => s.id);
    for (const id of PRIVACY_REQUIRED_SECTION_IDS) {
      assert(ids.includes(id), `missing privacy section: ${id}`);
    }
    assert(privacyDocument.id === 'privacy', 'privacy document id');
    assert(privacyDocument.effectiveDate === legalConfig.effectiveDate, 'privacy effective');
    assert(privacyDocument.updatedDate === legalConfig.updatedDate, 'privacy updated');
  });

  await test('Terms required sections present', () => {
    const ids = termsDocument.sections.map((s) => s.id);
    for (const id of TERMS_REQUIRED_SECTION_IDS) {
      assert(ids.includes(id), `missing terms section: ${id}`);
    }
    assert(termsDocument.id === 'terms', 'terms document id');
  });

  await test('EN/UR parity for all legal document keys', () => {
    for (const key of allDocKeys) {
      assert(hasTranslationKey(key, 'en'), `missing EN key: ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR key: ${key}`);
      assert(enFlat[key]?.trim().length, `empty EN: ${key}`);
      assert(urFlat[key]?.trim().length, `empty UR: ${key}`);
    }
  });

  await test('No placeholder / lorem legal copy', () => {
    for (const key of allDocKeys) {
      const enValue = enFlat[key]!;
      const urValue = urFlat[key]!;
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(enValue), `EN ${key} matched ${pattern}`);
        assert(!pattern.test(urValue), `UR ${key} matched ${pattern}`);
      }
    }
  });

  await test('No personal developer email in legal config or copy', () => {
    const haystacks = [configSrc, allLegalCopy, enFlat['privacy.sections.contact.p1']!, enFlat['terms.sections.contact.p1']!];
    for (const text of haystacks) {
      for (const pattern of PERSONAL_EMAIL_PATTERNS) {
        assert(!pattern.test(text), `personal email pattern ${pattern}`);
      }
    }
    assert(
      !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(configSrc.replace(/vidorax\.app/gi, '')),
      'config must not invent mailbox addresses',
    );
  });

  await test('No secret / internal infrastructure copy in legal content', () => {
    const contentSources = [
      privacyContentSrc,
      termsContentSrc,
      configSrc,
      documentView,
      privacyScreen,
      termsScreen,
      allLegalCopy,
    ].join('\n');
    for (const pattern of SECRET_INFRA_PATTERNS) {
      assert(!pattern.test(contentSources), `infra leak matched ${pattern}`);
    }
  });

  await test('No unsupported absolute-security claims', () => {
    for (const key of allDocKeys) {
      const value = `${enFlat[key]}\n${urFlat[key]}`;
      for (const pattern of ABSOLUTE_SECURITY_PATTERNS) {
        assert(!pattern.test(value), `${key} absolute-security matched ${pattern}`);
      }
    }
    assert(
      enFlat['privacy.sections.security.p2']!.toLowerCase().includes('not'),
      'security section must include cautious limitation wording',
    );
  });

  await test('Reusable structured content model (no giant JSX policy strings)', () => {
    assert(typesSrc.includes('headingKey'), 'typed headingKey');
    assert(typesSrc.includes('bodyKeys'), 'typed bodyKeys');
    assert(typesSrc.includes('itemKeys'), 'typed itemKeys');
    assert(privacyScreen.includes('privacyDocument'), 'Privacy uses shared doc');
    assert(termsScreen.includes('termsDocument'), 'Terms uses shared doc');
    assert(documentView.includes('document.sections'), 'renderer walks sections');
    assert(!privacyScreen.includes('lorem'), 'privacy screen clean');
    assert(
      !/"We collect".{200,}/s.test(privacyScreen),
      'PrivacyScreen must not embed long policy prose',
    );
    assert(
      !/"You agree".{200,}/s.test(termsScreen),
      'TermsScreen must not embed long policy prose',
    );
  });

  await test('Truthful product claims present in Privacy/Terms EN copy', () => {
    const privacyBlob = privacyKeys.map((k) => enFlat[k]).join('\n');
    const termsBlob = termsKeys.map((k) => enFlat[k]).join('\n');
    assert(privacyBlob.includes('local'), 'privacy distinguishes local storage');
    assert(privacyBlob.toLowerCase().includes('sync'), 'privacy mentions sync');
    assert(
      privacyBlob.toLowerCase().includes('does not offer a user account') ||
        privacyBlob.toLowerCase().includes('does not create a user account'),
      'privacy states VidoraX has no user account',
    );
    assert(
      privacyBlob.toLowerCase().includes('no cloud profile to delete') ||
        privacyBlob.toLowerCase().includes('does not currently offer a self-service'),
      'must not invent self-service account deletion',
    );
    assert(
      privacyBlob.toLowerCase().includes('not designed specifically for children'),
      'children section conservative',
    );
    assert(
      !privacyBlob.toLowerCase().includes('analytics sdk') ||
        privacyBlob.toLowerCase().includes('does not currently'),
      'analytics must be absent or explicitly denied',
    );
    assert(termsBlob.includes('DRM'), 'terms cover DRM');
    assert(
      termsBlob.toLowerCase().includes('bypass'),
      'terms forbid circumvention wording',
    );
    assert(
      !termsBlob.toLowerCase().includes('bypass drm to download'),
      'must not instruct DRM circumvention',
    );
  });

  await test('VidoraX brand remains untranslated in UR legal headings/body samples', () => {
    assert(urFlat['privacy.sections.introduction.p1']!.includes('VidoraX'), 'UR keeps VidoraX');
    assert(urFlat['terms.sections.acceptance.p1']!.includes('VidoraX'), 'UR terms keep VidoraX');
  });

  await test('Screens + npm script wired', () => {
    assert(packageJson.includes('verify:week8-5-phase3b1'), 'npm script missing');
    assert(privacyScreen.includes('LegalDocumentView'), 'Privacy uses LegalDocumentView');
    assert(termsScreen.includes('LegalDocumentView'), 'Terms uses LegalDocumentView');
    const documentHeader = readSrc('src/screens/legal/document/LegalDocumentHeader.tsx');
    assert(
      documentHeader.includes('legal.effectiveLabel') ||
        documentView.includes('legal.effectiveLabel'),
      'shows effective date label',
    );
    assert(documentView.includes('legalConfig'), 'interpolates public URLs from config');
    assert(privacyScreen.includes("t('privacy.title')"), 'Phase 2 privacy title contract');
    assert(termsScreen.includes("t('terms.title')"), 'Phase 2 terms title contract');
  });

  console.log('');
  console.log(`Week 8.5 Phase 3B.1: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
