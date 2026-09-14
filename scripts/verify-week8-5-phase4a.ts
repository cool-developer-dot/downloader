/**
 * Week 8.5 Phase 4A — Self-Service Help Center & FAQ Experience.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator required.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-5-phase4a.ts
 *   npm run verify:week8-5-phase4a
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../src/localization/en';
import { ur } from '../src/localization/ur';
import { flattenCatalog } from '../src/localization/types';
import { hasTranslationKey, translate } from '../src/localization/translate';
import { routePaths } from '../src/navigation/constants/route-paths';
import {
  SUPPORT_ACTIONS,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_IDS,
  SUPPORT_FAQ_IDS,
  SUPPORT_FAQ_ITEMS,
  getFaqsByCategory,
  getPopularFaqs,
  isValidSupportActionRoute,
  searchSupportFaqs,
} from '../src/support';

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

const REQUIRED_CATEGORY_IDS = [
  'getting-started',
  'downloads',
  'library-files',
  'playback',
  'account-settings',
] as const;

const REQUIRED_FAQ_IDS = [
  'how-to-download',
  'how-to-use-browser',
  'where-downloads-appear',
  'how-to-play-downloaded',
  'download-failed',
  'pause-and-resume',
  'wifi-only-downloads',
  'file-unavailable',
  'unsupported-source',
  'rename-media',
  'delete-media',
  'share-media',
  'open-externally',
  'favorites',
  'folders',
  'video-not-playing',
  'unsupported-codec',
  'resume-playback',
  'fullscreen-orientation',
  'login-account',
  'language-settings',
  'theme-settings',
  'storage-settings',
] as const;

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /coming soon/i,
  /future release/i,
  /will be implemented/i,
  /help center is not available/i,
  /full help center is not available/i,
  // User-visible "placeholder" copy — ignore JSX `placeholder={...}` props.
  /(?<![\w.])placeholder(?!\s*=)/i,
];

const VALID_ROUTES = new Set(Object.values(routePaths) as string[]);

async function main(): Promise<void> {
  const enFlat = flattenCatalog(en);
  const urFlat = flattenCatalog(ur);
  const supportScreen = readSrc('src/screens/support/SupportScreen.tsx');
  const supportDir = join(ROOT, 'src/screens/support');
  const supportModuleDir = join(ROOT, 'src/support');
  const supportUiText = collectFiles(supportDir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const supportModuleText = collectFiles(supportModuleDir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const packageJson = readSrc('package.json');

  await test('Required categories exist', () => {
    assert(SUPPORT_CATEGORIES.length === 5, 'exactly 5 categories');
    for (const id of REQUIRED_CATEGORY_IDS) {
      assert(SUPPORT_CATEGORY_IDS.includes(id), `missing category ${id}`);
    }
  });

  await test('FAQ ids unique and complete', () => {
    assert(SUPPORT_FAQ_ITEMS.length === REQUIRED_FAQ_IDS.length, 'FAQ count');
    assert(
      new Set(SUPPORT_FAQ_IDS).size === SUPPORT_FAQ_IDS.length,
      'FAQ ids must be unique',
    );
    for (const id of REQUIRED_FAQ_IDS) {
      assert(SUPPORT_FAQ_IDS.includes(id), `missing FAQ ${id}`);
    }
  });

  await test('FAQ categories are valid', () => {
    const categorySet = new Set(SUPPORT_CATEGORY_IDS);
    for (const item of SUPPORT_FAQ_ITEMS) {
      assert(categorySet.has(item.categoryId), `invalid category on ${item.id}`);
    }
    for (const id of REQUIRED_CATEGORY_IDS) {
      assert(getFaqsByCategory(id).length > 0, `empty category ${id}`);
    }
    assert(getPopularFaqs().length >= 4, 'popular FAQs present');
  });

  await test('EN/UR key parity for support FAQ + chrome', () => {
    const keys = new Set<string>();
    for (const item of SUPPORT_FAQ_ITEMS) {
      keys.add(item.questionKey);
      keys.add(item.answerKey);
      if (item.keywordsKey) {
        keys.add(item.keywordsKey);
      }
      if (item.actionLabelKey) {
        keys.add(item.actionLabelKey);
      }
    }
    for (const category of SUPPORT_CATEGORIES) {
      keys.add(category.titleKey);
      keys.add(category.descriptionKey);
    }
    for (const action of SUPPORT_ACTIONS) {
      keys.add(action.labelKey);
    }
    for (const key of [
      'support.title',
      'support.description',
      'support.searchPlaceholder',
      'support.noResultsTitle',
      'support.noResultsDescription',
      'support.categoriesHeading',
      'support.popularHeading',
      'support.resultsHeading',
      'support.expandA11y',
      'support.collapseA11y',
      'support.privacyQuestions',
      'support.deletionRequest',
    ]) {
      keys.add(key);
    }

    for (const key of keys) {
      assert(hasTranslationKey(key, 'en'), `missing EN ${key}`);
      assert(hasTranslationKey(key, 'ur'), `missing UR ${key}`);
      assert(enFlat[key]?.trim().length, `empty EN ${key}`);
      assert(urFlat[key]?.trim().length, `empty UR ${key}`);
    }
  });

  await test('No raw placeholder Support copy', () => {
    for (const src of [supportUiText, supportModuleText]) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(src), `placeholder ${pattern} in support source`);
      }
    }
    for (const key of Object.keys(enFlat).filter((k) => k.startsWith('support.'))) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        assert(!pattern.test(enFlat[key]!), `EN ${key} matched ${pattern}`);
        assert(!pattern.test(urFlat[key]!), `UR ${key} matched ${pattern}`);
      }
    }
  });

  await test('Search matches questions / categories / keywords; empty query returns none', () => {
    const tEn = (key: string) => translate(key as never, undefined, 'en');
    const wifiHits = searchSupportFaqs({
      query: 'wifi',
      faqs: SUPPORT_FAQ_ITEMS,
      categories: SUPPORT_CATEGORIES,
      t: tEn,
    });
    assert(
      wifiHits.some((item) => item.id === 'wifi-only-downloads'),
      'wifi keyword/question hit',
    );

    const browserHits = searchSupportFaqs({
      query: 'browser',
      faqs: SUPPORT_FAQ_ITEMS,
      categories: SUPPORT_CATEGORIES,
      t: tEn,
    });
    assert(browserHits.length > 0, 'browser search returns hits');

    const empty = searchSupportFaqs({
      query: '   ',
      faqs: SUPPORT_FAQ_ITEMS,
      categories: SUPPORT_CATEGORIES,
      t: tEn,
    });
    assert(empty.length === 0, 'empty/whitespace query returns no hits');
  });

  await test('Deep actions map only to valid existing routes', () => {
    for (const action of SUPPORT_ACTIONS) {
      assert(VALID_ROUTES.has(action.route), `unknown route ${action.route}`);
      assert(isValidSupportActionRoute(action.route), `validator reject ${action.id}`);
    }
    for (const item of SUPPORT_FAQ_ITEMS) {
      if (!item.actionId) {
        continue;
      }
      const action = SUPPORT_ACTIONS.find((a) => a.id === item.actionId);
      assert(action, `FAQ ${item.id} action missing`);
      assert(VALID_ROUTES.has(action!.route), `FAQ ${item.id} bad route`);
    }
  });

  await test('No backend / React Query / Support global store in FAQ path', () => {
    assert(!supportModuleText.includes('useQuery'), 'no React Query in support module');
    assert(!supportModuleText.includes('@tanstack'), 'no TanStack in support module');
    assert(!supportModuleText.includes('fetch('), 'no fetch in support module');
    assert(!supportModuleText.includes('axios'), 'no axios in support module');
    assert(!supportModuleText.includes('create('), 'no zustand create in support module');
    assert(
      !supportUiText.includes('useQuery') && !supportUiText.includes('@tanstack'),
      'no React Query in support UI',
    );
    assert(
      supportScreen.includes('useState') && supportScreen.includes('useMemo'),
      'local state + memoized derivation',
    );
  });

  await test('Accordion accessibility contract present', () => {
    assert(supportUiText.includes('accessibilityState'), 'accessibilityState used');
    assert(
      supportUiText.includes('expanded') || supportUiText.includes('expanded:'),
      'expanded state referenced',
    );
    assert(
      supportUiText.includes("accessibilityRole=\"button\"") ||
        supportUiText.includes("accessibilityRole='button'"),
      'FAQ toggle button role',
    );
  });

  await test('npm script wired', () => {
    assert(packageJson.includes('verify:week8-5-phase4a'), 'npm script missing');
  });

  console.log('');
  console.log(`Week 8.5 Phase 4A: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
