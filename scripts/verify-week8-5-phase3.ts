/**
 * Week 8.5 Phase 3 — Final legal certification aggregator.
 * Runs Phase 2 + 3A + 3B.1 + 3B.2, then Phase 3 freeze/safety checks.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase3.ts
 *   npm run verify:week8-5-phase3
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
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

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (extname(full) === '.ts' || extname(full) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

function runSubVerifier(scriptRel: string, label: string): void {
  const result = spawnSync(
    'npx',
    ['tsx', join(ROOT, scriptRel)],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      shell: true,
    },
  );
  if (result.status !== 0) {
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${label} failed (exit ${result.status})\n${out}`);
  }
  console.log(`  └─ ${label} OK`);
}

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bHACK\b/,
  /\bTEMP\b(?![A-Z_])/,
  /coming soon/i,
  /future release/i,
  /example\.com/i,
  /your-domain\.com/i,
  /test@[a-z0-9.-]+/i,
  /dev@[a-z0-9.-]+/i,
  /\blocalhost\b/i,
];

const SECRET_PATTERNS = [
  /api\.vidorax\.com/i,
  /EXPO_PUBLIC_/i,
  /passwordHash/i,
  /DATABASE_URL/i,
  /JWT_SECRET/i,
  /postgresql:\/\//i,
  /SUPABASE_SERVICE/i,
];

const PRODUCTION_SCAN_DIRS = [
  'src/legal',
  'src/screens/legal',
  'src/screens/settings/components/LegalSection.tsx',
];

const PRIVACY_REQUIRED = [
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

const TERMS_REQUIRED = [
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

async function main(): Promise<void> {
  console.log('Week 8.5 Phase 3 — running subverifiers…\n');

  await test('Phase 2 localization subverifier', () => {
    runSubVerifier('scripts/verify-week8-5-phase2.ts', 'Phase 2');
  });
  await test('Phase 3A About subverifier', () => {
    runSubVerifier('scripts/verify-week8-5-phase3a.ts', 'Phase 3A');
  });
  await test('Phase 3B.1 legal content subverifier', () => {
    runSubVerifier('scripts/verify-week8-5-phase3b1.ts', 'Phase 3B.1');
  });
  await test('Phase 3B.2 legal UI/nav subverifier', () => {
    runSubVerifier('scripts/verify-week8-5-phase3b2.ts', 'Phase 3B.2');
  });

  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);
  const aboutScreen = readSrc('src/screens/legal/AboutScreen.tsx');
  const legalSection = readSrc('src/screens/settings/components/LegalSection.tsx');
  const appIdentity = readSrc('src/constants/app-identity.ts');
  const freezeDoc = readSrc('src/legal/PHASE3-FREEZE.md');
  const packageJson = readSrc('package.json');

  await test('Legal routes + required sections', () => {
    assert(routePaths.privacy === '/privacy', 'privacy route');
    assert(routePaths.terms === '/terms', 'terms route');
    assert(routePaths.about === '/about', 'about route');
    assert(routePaths.support === '/support', 'support route');
    const privacyIds = privacyDocument.sections.map((s) => s.id);
    const termsIds = termsDocument.sections.map((s) => s.id);
    for (const id of PRIVACY_REQUIRED) {
      assert(privacyIds.includes(id), `privacy missing ${id}`);
    }
    for (const id of TERMS_REQUIRED) {
      assert(termsIds.includes(id), `terms missing ${id}`);
    }
    assert(
      privacyIds.includes('information-processed') &&
        Boolean(enFlat['privacy.sections.informationProcessed.itemLocalMedia']?.length),
      'local media disclosure present (no profile-photo / account claim)',
    );
    assert(
      !enFlat['privacy.sections.informationProcessed.itemProfilePhoto'],
      'profile-photo privacy key must stay removed for local-only',
    );
  });

  await test('Contact safety + no openable unpublished web', () => {
    assert(legalConfig.contact.privacyEmail === null, 'privacy email null');
    assert(legalConfig.contact.supportEmail === null, 'support email null');
    assert(!isLegalContactConfigured(), 'contact unconfigured');
    assert(legalConfig.publicWebPublished === false, 'public web unpublished');
    assert(!isPublicLegalWebOpenable(), 'web openable gated');
    assert(
      /PLAY_STORE_LISTING_URL[^=]*=\s*null/.test(appIdentity),
      'Play Store listing unset',
    );
  });

  await test('Settings Legal + About legal links', () => {
    assert(legalSection.includes('routePaths.privacy'), 'Settings → Privacy');
    assert(legalSection.includes('routePaths.terms'), 'Settings → Terms');
    assert(legalSection.includes('routePaths.about'), 'Settings → About');
    assert(aboutScreen.includes('routePaths.support'), 'About → Support');
    assert(aboutScreen.includes('routePaths.privacy'), 'About → Privacy');
    assert(aboutScreen.includes('routePaths.terms'), 'About → Terms');
  });

  await test('Truthful update/rate gating preserved', () => {
    assert(
      /PLAY_STORE_LISTING_URL[^=]*=\s*null/.test(appIdentity),
      'Play Store URL remains null',
    );
    assert(aboutScreen.includes('updateCheckEnabled'), 'update gated in About');
    assert(aboutScreen.includes('rateEnabled'), 'rate gated in About');
    assert(appIdentity.includes('Expo Go'), 'Expo Go vs standalone documented');
  });

  await test('Local-only privacy items (no profile-photo key)', () => {
    const removed = 'privacy.sections.informationProcessed.itemProfilePhoto';
    assert(!enFlat[removed], 'EN profile-photo key removed');
    assert(!urFlat[removed], 'UR profile-photo key removed');
    assert(
      Boolean(enFlat['privacy.sections.informationProcessed.itemLocalMedia']),
      'EN local media item',
    );
    assert(
      Boolean(urFlat['privacy.sections.informationProcessed.itemLocalMedia']),
      'UR local media item',
    );
  });

  await test('Production legal/About placeholder + secret scan', () => {
    const files: string[] = [];
    for (const entry of PRODUCTION_SCAN_DIRS) {
      const full = join(ROOT, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        collectFiles(full, files);
      } else {
        files.push(full);
      }
    }
    files.push(join(ROOT, 'src/constants/app-identity.ts'));

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file);
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(text), `${rel} matched ${pattern}`);
      }
      for (const pattern of SECRET_PATTERNS) {
        assert(!pattern.test(text), `${rel} secret leak ${pattern}`);
      }
    }
  });

  await test('Freeze documentation present', () => {
    assert(freezeDoc.includes('Frozen'), 'freeze doc');
    assert(freezeDoc.includes('publicWebPublished'), 'documents web gate');
    assert(freezeDoc.includes('Play Store'), 'documents store URL');
    assert(packageJson.includes('verify:week8-5-phase3'), 'npm script');
  });

  console.log('');
  console.log(`Week 8.5 Phase 3: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
