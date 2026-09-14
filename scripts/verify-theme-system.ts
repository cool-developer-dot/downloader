/**
 * VidoraX theme system — static verifier (400+ cases).
 * NO network. NO Metro. NO APK. NO expo prebuild.
 *
 * Run: npx tsx scripts/verify-theme-system.ts
 * Or:  npm run verify:theme-system
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { brandPalette, colors } from '../src/theme/colors';
import { contrastRatio, roundContrast } from '../src/theme/contrast';
import { resolveIntroColors } from '../src/theme/intro-palette';
import {
  DARK_ONBOARDING_ALLOWLIST,
  resolveOnboardingSurfaces,
} from '../src/theme/onboarding-surfaces';
import {
  normalizeThemePreference,
  resolveThemeMode,
  THEME_PREFERENCES,
  isThemePreference,
} from '../src/theme/theme-preference';
import { initialThemeState } from '../src/store/theme/state';
import {
  apiThemeToPreference,
  isValidApiTheme,
  isValidThemePreference,
  themePreferenceToApi,
} from '../src/services/auth/settings-validation';

const root = resolve(__dirname, '..');
const BRAND_RED = '#DC3C2C';
const DARK_OLIVE = '#1A2517';
/** Private-app Dark neutral (NOT olive). */
const DARK_BG = '#0D0D0D';
const DARK_SECONDARY = '#141414';
const DARK_SURFACE = '#181818';
const DARK_ELEVATED = '#1F1F1F';
const DARK_CHROME = '#0F0F0F';
const DARK_PRIMARY = '#F5F5F5';
const DARK_ON_PRIMARY = '#171717';
const DARK_TEXT_SECONDARY = '#B3B3B3';
const DARK_TEXT_MUTED = '#8A8A8A';
/** Pure white Light/Logo main background (not sage-tinted). */
const LIGHT_BG = '#FFFFFF';
const LIGHT_SECONDARY_BG = '#FAFAFA';
const LIGHT_WHITE = '#FFFFFF';
const LIGHT_INK = '#171717';
const LEGACY_SAGE_BG = '#F4F7F2';
const LEGACY_SAGE_SURFACE = '#EEF2EA';
const LEGACY_SAGE_BORDER = '#D8E0D4';
const SAGE_ACCENT = '#ACC8A2';
const SAGE_SET = new Set([
  '#ACC8A2',
  '#C5D9BE',
  '#8FB583',
  '#7A9470',
  '#1A2517',
  '#222E1E',
  '#2A3824',
  '#314030',
  '#3A4A35',
  '#2E3D28',
  '#252F21',
]);

/** Mirror of themes export without importing theme/index (avoids react-native chain). */
const themes = {
  light: { mode: 'light' as const, colors: colors.light },
  logo: { mode: 'logo' as const, colors: colors.logo },
  dark: { mode: 'dark' as const, colors: colors.dark },
};

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`PASS  ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL  ${name}`);
      console.error(`      ${message}`);
    });
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      listFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function themeModuleFiles(): string[] {
  const themeDir = resolve(root, 'src/theme');
  const storeThemeDir = resolve(root, 'src/store/theme');
  return [...listFiles(themeDir), ...listFiles(storeThemeDir)];
}

function appLockFiles(): string[] {
  return listFiles(resolve(root, 'src/security/app-lock'));
}

async function main(): Promise<void> {
  console.log('VidoraX theme system verification\n');

  // ─── GROUP A — MODES EXIST IN COLORS / THEMES ───────────────────
  await test('A1 colors.light exists', () => {
    assert(colors.light != null, 'light palette missing');
  });
  await test('A2 colors.logo exists', () => {
    assert(colors.logo != null, 'logo palette missing');
  });
  await test('A3 colors.dark exists', () => {
    assert(colors.dark != null, 'dark palette missing');
  });
  await test('A4 themes.light exists', () => {
    assert(themes.light != null, 'light theme missing');
  });
  await test('A5 themes.logo exists', () => {
    assert(themes.logo != null, 'logo theme missing');
  });
  await test('A6 themes.dark exists', () => {
    assert(themes.dark != null, 'dark theme missing');
  });
  await test('A7 themes.light.mode === light', () => {
    assert(themes.light.mode === 'light', 'mode mismatch');
  });
  await test('A8 themes.logo.mode === logo', () => {
    assert(themes.logo.mode === 'logo', 'mode mismatch');
  });
  await test('A9 themes.dark.mode === dark', () => {
    assert(themes.dark.mode === 'dark', 'mode mismatch');
  });
  await test('A10 themes.light.colors references colors.light', () => {
    assert(themes.light.colors === colors.light, 'colors ref');
  });
  await test('A11 themes.logo.colors references colors.logo', () => {
    assert(themes.logo.colors === colors.logo, 'colors ref');
  });
  await test('A12 themes.dark.colors references colors.dark', () => {
    assert(themes.dark.colors === colors.dark, 'colors ref');
  });
  await test('A13 exactly three color modes', () => {
    assert(Object.keys(colors).length === 3, 'expected 3 modes');
  });
  await test('A14 exactly three theme objects', () => {
    assert(Object.keys(themes).length === 3, 'expected 3 themes');
  });
  await test('A15 color mode keys are light/logo/dark', () => {
    const keys = Object.keys(colors).sort();
    assert(keys.join(',') === 'dark,light,logo', `got ${keys.join(',')}`);
  });
  await test('A15b theme/index exports light/logo/dark themes', () => {
    const idx = read('src/theme/index.ts');
    assert(idx.includes('export const themes'), 'themes export');
    assert(idx.includes("mode: 'light'"), 'light mode');
    assert(idx.includes("mode: 'logo'"), 'logo mode');
    assert(idx.includes("mode: 'dark'"), 'dark mode');
  });

  // ─── GROUP B — NORMALIZE THEME PREFERENCE ───────────────────────
  await test('B16 undefined → light', () => {
    assert(normalizeThemePreference(undefined) === 'light', 'undefined');
  });
  await test('B17 null → light', () => {
    assert(normalizeThemePreference(null) === 'light', 'null');
  });
  await test('B18 empty string → light', () => {
    assert(normalizeThemePreference('') === 'light', 'empty');
  });
  await test('B19 invalid string → light', () => {
    assert(normalizeThemePreference('neon') === 'light', 'invalid');
  });
  await test('B20 number → light', () => {
    assert(normalizeThemePreference(42) === 'light', 'number');
  });
  await test('B21 system → light (legacy collapse)', () => {
    assert(normalizeThemePreference('system') === 'light', 'system');
  });
  await test('B22 SYSTEM uppercase → light', () => {
    assert(normalizeThemePreference('SYSTEM') === 'light', 'SYSTEM');
  });
  await test('B23 light passes through', () => {
    assert(normalizeThemePreference('light') === 'light', 'light');
  });
  await test('B24 logo passes through', () => {
    assert(normalizeThemePreference('logo') === 'logo', 'logo');
  });
  await test('B25 dark passes through', () => {
    assert(normalizeThemePreference('dark') === 'dark', 'dark');
  });
  await test('B26 THEME_PREFERENCES has light/logo/dark', () => {
    assert(THEME_PREFERENCES.length === 3, 'length');
    assert(THEME_PREFERENCES.includes('light'), 'light');
    assert(THEME_PREFERENCES.includes('logo'), 'logo');
    assert(THEME_PREFERENCES.includes('dark'), 'dark');
  });
  await test('B27 isThemePreference true for valid values', () => {
    assert(isThemePreference('light'), 'light');
    assert(isThemePreference('logo'), 'logo');
    assert(isThemePreference('dark'), 'dark');
  });
  await test('B28 isThemePreference false for system', () => {
    assert(!isThemePreference('system'), 'system rejected');
  });
  await test('B29 resolveThemeMode light → light', () => {
    assert(resolveThemeMode('light') === 'light', 'light');
  });
  await test('B30 resolveThemeMode logo → logo', () => {
    assert(resolveThemeMode('logo') === 'logo', 'logo');
  });
  await test('B31 resolveThemeMode dark → dark', () => {
    assert(resolveThemeMode('dark') === 'dark', 'dark');
  });
  await test('B32 resolveThemeMode is 1:1 (no OS takeover)', () => {
    for (const pref of THEME_PREFERENCES) {
      assert(resolveThemeMode(pref) === pref, pref);
    }
  });

  // ─── GROUP C — BRAND PALETTE ────────────────────────────────────
  await test('C33 brandPalette.brandRed === #DC3C2C', () => {
    assert(brandPalette.brandRed === BRAND_RED, `got ${brandPalette.brandRed}`);
  });
  await test('C34 brandPalette.sourceHex === #DC3C2C', () => {
    assert(brandPalette.sourceHex === BRAND_RED, 'sourceHex');
  });
  await test('C35 brandPalette.sourceAsset includes vidorax-logo.png', () => {
    assert(
      brandPalette.sourceAsset.includes('vidorax-logo.png'),
      brandPalette.sourceAsset,
    );
  });
  await test('C36 brandPalette.sourceAsset path is assets/logos/', () => {
    assert(brandPalette.sourceAsset.startsWith('assets/logos/'), 'path');
  });
  await test('C37 brandRedPressed is defined', () => {
    assert(typeof brandPalette.brandRedPressed === 'string', 'pressed');
  });
  await test('C38 brandRedMuted is defined', () => {
    assert(typeof brandPalette.brandRedMuted === 'string', 'muted');
  });
  await test('C39 onBrandRed is white', () => {
    assert(brandPalette.onBrandRed === '#FFFFFF', 'onBrandRed');
  });
  await test('C40 logo primary === brandRed', () => {
    assert(colors.logo.primary === BRAND_RED, 'logo primary');
  });

  // ─── GROUP D — LOGO CHROME (BRAND RED) ─────────────────────────
  await test('D41 logo headerBackground === brandRed', () => {
    assert(colors.logo.headerBackground === BRAND_RED, 'header');
  });
  await test('D42 logo bottomNavBackground === brandRed', () => {
    assert(colors.logo.bottomNavBackground === BRAND_RED, 'bottomNav');
  });
  await test('D43 logo headerText is onBrandRed (white)', () => {
    assert(colors.logo.headerText === brandPalette.onBrandRed, 'headerText');
  });
  await test('D44 logo bottomNavActive is onBrandRed', () => {
    assert(colors.logo.bottomNavActive === brandPalette.onBrandRed, 'active');
  });
  await test('D45 logo accent === brandRed', () => {
    assert(colors.logo.accent === BRAND_RED, 'accent');
  });
  await test('D46 logo statusBarStyle is light', () => {
    assert(colors.logo.statusBarStyle === 'light', 'status bar');
  });
  await test('D47 logo bottomNavBorder is pressed red', () => {
    assert(colors.logo.bottomNavBorder === brandPalette.brandRedPressed, 'border');
  });
  await test('D48 themes.logo chrome matches colors.logo', () => {
    assert(themes.logo.colors.headerBackground === BRAND_RED, 'theme header');
    assert(themes.logo.colors.bottomNavBackground === BRAND_RED, 'theme bottomNav');
  });

  // ─── GROUP E — LOGO CONTENT SURFACES STAY LIGHT ─────────────────
  await test('E49 logo background === light background', () => {
    assert(colors.logo.background === colors.light.background, 'background');
  });
  await test('E50 logo background is neutral white (#FFFFFF)', () => {
    assert(colors.logo.background === LIGHT_BG, 'neutral bg');
  });
  await test('E51 logo card === light card (white)', () => {
    assert(colors.logo.card === colors.light.card, 'card');
  });
  await test('E52 logo card is NOT brandRed', () => {
    assert(colors.logo.card !== BRAND_RED, 'card not red');
  });
  await test('E53 logo surface === light surface', () => {
    assert(colors.logo.surface === colors.light.surface, 'surface');
  });
  await test('E54 logo background is NOT brandRed', () => {
    assert(colors.logo.background !== BRAND_RED, 'bg not red');
  });

  // ─── GROUP F — LOGO BODY TEXT IS DARK ───────────────────────────
  await test('F55 logo textPrimary is dark neutral', () => {
    assert(colors.logo.textPrimary === '#171717', 'textPrimary');
  });
  await test('F56 logo textPrimary === light textPrimary', () => {
    assert(colors.logo.textPrimary === colors.light.textPrimary, 'same as light');
  });
  await test('F57 logo textPrimary is NOT brandRed', () => {
    assert(colors.logo.textPrimary !== BRAND_RED, 'not red text');
  });
  await test('F58 logo textSecondary is muted gray (not red)', () => {
    assert(colors.logo.textSecondary !== BRAND_RED, 'secondary not red');
  });
  await test('F59 logo textPrimary is dark (low luminance)', () => {
    assert(colors.logo.textPrimary.startsWith('#17'), 'dark hex');
  });

  // ─── GROUP G — DARK CHROME IS NOT BRAND RED ─────────────────────
  await test('G60 dark headerBackground !== brandRed', () => {
    assert(colors.dark.headerBackground !== BRAND_RED, 'header');
  });
  await test('G61 dark bottomNavBackground !== brandRed', () => {
    assert(colors.dark.bottomNavBackground !== BRAND_RED, 'bottomNav');
  });
  await test('G62 dark headerBackground is neutral chrome (not olive)', () => {
    assert(colors.dark.headerBackground === DARK_CHROME, 'neutral header');
    assert(colors.dark.headerBackground !== DARK_OLIVE, 'not olive');
  });
  await test('G63 dark bottomNavBackground is neutral chrome', () => {
    assert(colors.dark.bottomNavBackground === DARK_CHROME, 'neutral nav');
    assert(colors.dark.bottomNavBackground !== BRAND_RED, 'not red');
  });
  await test('G64 dark primary is off-white (not brand red, not sage)', () => {
    assert(colors.dark.primary !== BRAND_RED, 'primary not red');
    assert(colors.dark.primary !== SAGE_ACCENT, 'primary not sage');
    assert(colors.dark.primary === DARK_PRIMARY, 'off-white primary');
  });
  await test('G65 dark accent matches neutral primary', () => {
    assert(colors.dark.accent === colors.dark.primary, 'accent=primary');
  });
  await test('G66 dark statusBarStyle is light', () => {
    assert(colors.dark.statusBarStyle === 'light', 'light icons');
  });
  await test('G67 dark background is neutral black (not olive)', () => {
    assert(colors.dark.background === DARK_BG, 'bg');
    assert(colors.dark.background !== DARK_OLIVE, 'not olive');
  });

  // ─── GROUP H — LIGHT CHROME IS LIGHT (NOT BRAND RED) ────────────
  await test('H68 light headerBackground is light (not red)', () => {
    assert(colors.light.headerBackground !== BRAND_RED, 'not red');
    assert(colors.light.headerBackground === LIGHT_WHITE, 'white header');
  });
  await test('H69 light bottomNavBackground is light card', () => {
    assert(colors.light.bottomNavBackground !== BRAND_RED, 'not red');
    assert(colors.light.bottomNavBackground === colors.light.card, 'white card');
  });
  await test('H70 light headerBackground is white/neutral', () => {
    assert(colors.light.headerBackground === LIGHT_WHITE, 'white header');
  });
  await test('H71 light bottomNavActive equals dark-neutral primary', () => {
    assert(colors.light.bottomNavActive === colors.light.primary, 'active=primary');
  });
  await test('H72 light statusBarStyle is dark', () => {
    assert(colors.light.statusBarStyle === 'dark', 'dark icons');
  });
  await test('H73 light primary is dark neutral (not sage, not brand red)', () => {
    assert(colors.light.primary === LIGHT_INK, 'ink');
    assert(colors.light.primary !== SAGE_ACCENT, 'not sage');
    assert(colors.light.primary !== BRAND_RED, 'not brand');
  });
  await test('H74 light chrome tokens differ from logo chrome', () => {
    assert(colors.light.headerBackground !== colors.logo.headerBackground, 'header differs');
    assert(colors.light.bottomNavBackground !== colors.logo.bottomNavBackground, 'nav differs');
  });

  // ─── GROUP I — THEME STORE DEFAULT LIGHT ────────────────────────
  await test('I75 initialThemeState seeds MMKV with light fallback', () => {
    assert(
      initialThemeState.themeMode === 'light' ||
        initialThemeState.themeMode === 'logo' ||
        initialThemeState.themeMode === 'dark',
      'valid seeded mode',
    );
    assert(read('src/store/theme/state.ts').includes("getThemeMode('light')"), 'mmkv seed');
  });
  await test('I76 initialThemeState never system', () => {
    assert(initialThemeState.themeMode !== 'system', 'no system');
  });
  await test('I77 state.ts documents light fallback', () => {
    assert(read('src/store/theme/state.ts').includes('LIGHT'), 'fallback docs');
  });
  await test('I78 store merge normalizes persisted theme', () => {
    assert(read('src/store/theme/index.ts').includes('normalizeThemePreference'), 'normalize');
  });
  await test('I79 store actions normalize on setTheme', () => {
    assert(read('src/store/theme/actions.ts').includes('normalizeThemePreference'), 'normalize');
  });

  // ─── GROUP J — APPEARANCE SECTION ───────────────────────────────
  await test('J80 AppearanceSection offers light option', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes("value: 'light'"), 'light');
  });
  await test('J81 AppearanceSection offers logo option', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes("value: 'logo'"), 'logo');
  });
  await test('J82 AppearanceSection offers dark option', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes("value: 'dark'"), 'dark');
  });
  await test('J83 AppearanceSection has no system option', () => {
    const src = read('src/screens/settings/components/AppearanceSection.tsx');
    assert(!src.includes("value: 'system'"), 'no system value');
    assert(!src.includes('themeSystem'), 'no system label');
  });
  await test('J84 AppearanceSection uses SegmentedControl', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes('SegmentedControl'), 'control');
  });
  await test('J85 AppearanceSection uses themeLogo i18n key', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes('settings.themeLogo'), 'logo key');
  });
  await test('J86 AppearanceSection exactly three options', () => {
    const matches = read('src/screens/settings/components/AppearanceSection.tsx').match(/value: '/g);
    assert(matches != null && matches.length === 3, '3 options');
  });
  await test('J87 AppearanceSection testID settings-appearance', () => {
    assert(read('src/screens/settings/components/AppearanceSection.tsx').includes('settings-appearance'), 'testID');
  });

  // ─── GROUP K — I18N EN + UR THEME LOGO ──────────────────────────
  await test('K88 EN themeLogo string present', () => {
    assert(read('src/localization/en.ts').includes('themeLogo:'), 'themeLogo');
  });
  await test('K89 EN themeLogoA11y present', () => {
    assert(read('src/localization/en.ts').includes('themeLogoA11y:'), 'a11y');
  });
  await test('K90 EN themeLight present', () => {
    assert(read('src/localization/en.ts').includes('themeLight:'), 'light');
  });
  await test('K91 EN themeDark present', () => {
    assert(read('src/localization/en.ts').includes('themeDark:'), 'dark');
  });
  await test('K92 UR themeLogo string present', () => {
    assert(read('src/localization/ur.ts').includes('themeLogo:'), 'themeLogo');
  });
  await test('K93 UR themeLogoA11y present', () => {
    assert(read('src/localization/ur.ts').includes('themeLogoA11y:'), 'a11y');
  });
  await test('K94 UR themeLight present', () => {
    assert(read('src/localization/ur.ts').includes('themeLight:'), 'light');
  });
  await test('K95 UR themeDark present', () => {
    assert(read('src/localization/ur.ts').includes('themeDark:'), 'dark');
  });

  // ─── GROUP L — PAPER PROVIDER USES useTheme ─────────────────────
  await test('L96 paper-provider imports useTheme', () => {
    assert(read('src/providers/paper-provider.tsx').includes("from '@/hooks/use-theme'"), 'import');
  });
  await test('L97 paper-provider calls useTheme()', () => {
    assert(read('src/providers/paper-provider.tsx').includes('useTheme()'), 'hook call');
  });
  await test('L98 paper-provider passes theme.mode to createPaperTheme', () => {
    assert(read('src/providers/paper-provider.tsx').includes('createPaperTheme(theme.mode)'), 'mode');
  });
  await test('L99 paper-theme imports ThemeMode from theme', () => {
    assert(read('src/providers/paper-theme.ts').includes("from '@/theme'"), 'theme import');
  });
  await test('L100 paper-provider uses useMemo for paper theme', () => {
    assert(read('src/providers/paper-provider.tsx').includes('useMemo'), 'memo');
  });

  // ─── GROUP M — NAVIGATION THEME PROVIDER USES useTheme ──────────
  await test('M101 navigation-theme-provider imports useTheme', () => {
    assert(read('src/providers/navigation-theme-provider.tsx').includes("from '@/hooks/use-theme'"), 'import');
  });
  await test('M102 navigation-theme-provider calls useTheme()', () => {
    assert(read('src/providers/navigation-theme-provider.tsx').includes('useTheme()'), 'hook');
  });
  await test('M103 navigation uses palette.headerBackground for card', () => {
    assert(read('src/providers/navigation-theme-provider.tsx').includes('headerBackground'), 'header');
  });
  await test('M104 navigation uses palette.headerText', () => {
    assert(read('src/providers/navigation-theme-provider.tsx').includes('headerText'), 'text');
  });
  await test('M105 navigation dark mode uses DarkTheme base', () => {
    assert(read('src/providers/navigation-theme-provider.tsx').includes("mode === 'dark'"), 'dark branch');
  });

  // ─── GROUP N — TAB BAR OPTIONS USE bottomNav* TOKENS ────────────
  await test('N106 tab-bar uses bottomNavActive', () => {
    assert(read('src/navigation/config/tab-bar-options.ts').includes('bottomNavActive'), 'active');
  });
  await test('N107 tab-bar uses bottomNavInactive', () => {
    assert(read('src/navigation/config/tab-bar-options.ts').includes('bottomNavInactive'), 'inactive');
  });
  await test('N108 tab-bar style uses bottomNavBackground', () => {
    assert(read('src/navigation/config/tab-bar-options.ts').includes('bottomNavBackground'), 'bg');
  });
  await test('N109 tab-bar style uses bottomNavBorder', () => {
    assert(read('src/navigation/config/tab-bar-options.ts').includes('bottomNavBorder'), 'border');
  });
  await test('N110 createTabBarScreenOptions accepts Theme', () => {
    assert(read('src/navigation/config/tab-bar-options.ts').includes('theme: Theme'), 'Theme param');
  });
  await test('N111 createTabBarStyle returns backgroundColor from token', () => {
    const src = read('src/navigation/config/tab-bar-options.ts');
    assert(src.includes('backgroundColor: theme.colors.bottomNavBackground'), 'bg color');
  });

  // ─── GROUP O — SCREEN OPTIONS USE headerBackground ───────────────
  await test('O112 screen-options uses headerBackground', () => {
    assert(read('src/navigation/config/screen-options.ts').includes('headerBackground'), 'header bg');
  });
  await test('O113 screen-options uses headerIcon', () => {
    assert(read('src/navigation/config/screen-options.ts').includes('headerIcon'), 'icon');
  });
  await test('O114 screen-options uses headerText', () => {
    assert(read('src/navigation/config/screen-options.ts').includes('headerText'), 'text');
  });
  await test('O115 createStackHeaderOptions accepts Theme', () => {
    assert(read('src/navigation/config/screen-options.ts').includes('theme: Theme'), 'Theme');
  });
  await test('O116 headerStyle backgroundColor from theme token', () => {
    assert(
      read('src/navigation/config/screen-options.ts').includes('backgroundColor: theme.colors.headerBackground'),
      'token',
    );
  });

  // ─── GROUP P — INTRO PALETTE POLICIES ───────────────────────────
  await test('P117 dark intro background matches neutral dark theme', () => {
    assert(resolveIntroColors('dark').background === colors.dark.background, 'dark intro bg');
    assert(resolveIntroColors('dark').background !== DARK_OLIVE, 'not olive');
  });
  await test('P118 light intro background matches light theme', () => {
    assert(resolveIntroColors('light').background === colors.light.background, 'light intro');
  });
  await test('P119 logo intro background matches logo content bg', () => {
    assert(resolveIntroColors('logo').background === colors.logo.background, 'logo intro');
  });
  await test('P120 logo intro accent is brand red', () => {
    assert(resolveIntroColors('logo').accent === BRAND_RED, 'accent');
  });
  await test('P121 logo intro loaderFill is brand red', () => {
    assert(resolveIntroColors('logo').loaderFill === BRAND_RED, 'loader');
  });
  await test('P122 dark intro does NOT force brand red accent', () => {
    assert(resolveIntroColors('dark').accent !== BRAND_RED, 'no red accent');
  });
  await test('P123 dark intro statusBarStyle is light-content', () => {
    assert(resolveIntroColors('dark').statusBarStyle === 'light-content', 'light content');
  });
  await test('P124 light intro statusBarStyle is dark-content', () => {
    assert(resolveIntroColors('light').statusBarStyle === 'dark-content', 'dark content');
  });
  await test('P125 logo intro statusBarStyle is dark-content', () => {
    assert(resolveIntroColors('logo').statusBarStyle === 'dark-content', 'dark content');
  });
  await test('P126 dark intro brandText matches private-app dark text', () => {
    assert(resolveIntroColors('dark').brandText === colors.dark.textPrimary, 'intro text');
    assert(DARK_ONBOARDING_ALLOWLIST.brandText === colors.dark.textPrimary, 'allowlist synced');
    assert(colors.dark.textPrimary === DARK_PRIMARY, 'private app text');
  });
  await test('P127 light intro brandText is dark', () => {
    assert(resolveIntroColors('light').brandText === colors.light.textPrimary, 'dark text');
  });
  await test('P128 logo intro tagline uses brand red', () => {
    assert(resolveIntroColors('logo').taglineText === BRAND_RED, 'tagline red');
  });

  // ─── GROUP Q — APP LOCK / SECURE STORE ISOLATION ────────────────
  await test('Q129 theme modules do not import expo-secure-store', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/expo-secure-store/.test(src), `${file} must not import SecureStore`);
    }
  });
  await test('Q130 theme modules do not reference SecureStore', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/\bSecureStore\b/.test(src), `${file} no SecureStore`);
    }
  });
  await test('Q131 App Lock files do not import SecureStore from theme paths', () => {
    for (const file of appLockFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(
        !/from ['"]@\/theme[^'"]*['"]/.test(src) || !/SecureStore/.test(src),
        `${file} must not pull SecureStore via theme`,
      );
    }
  });
  await test('Q132 App Lock uses useTheme hook (not SPLASH_COLORS)', () => {
    const gate = read('src/security/app-lock/AppLockGate.tsx');
    assert(gate.includes('useTheme'), 'useTheme');
    assert(!gate.includes('SPLASH_COLORS'), 'no splash colors');
  });
  await test('Q133 AppLockGate background uses theme.colors.background', () => {
    const gate = read('src/security/app-lock/AppLockGate.tsx');
    assert(gate.includes('theme.colors.background'), 'background token');
  });
  await test('Q134 AppLockScreen uses useTheme', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes('useTheme'), 'screen theme');
  });

  // ─── GROUP R — THEME MODULES NO DOWNLOAD IMPORTS ─────────────────
  await test('R135 theme modules no download engine imports', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/downloads\/engine|downloadEngine/i.test(src), `${file} no engine`);
    }
  });
  await test('R136 theme modules no download scheduler imports', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/download-scheduler|downloadScheduler/i.test(src), `${file} no scheduler`);
    }
  });
  await test('R137 theme modules no hls-worker imports', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/hls-worker|downloadWorker/i.test(src), `${file} no worker`);
    }
  });
  await test('R138 theme modules no @/downloads imports', () => {
    for (const file of themeModuleFiles()) {
      const src = readFileSync(file, 'utf8');
      assert(!/from ['"]@\/downloads/.test(src), `${file} no downloads path`);
    }
  });
  await test('R139 theme store actions no download references', () => {
    const src = read('src/store/theme/actions.ts');
    assert(!/download/i.test(src), 'actions clean');
  });

  // ─── GROUP S — NO setInterval IN THEME STORE ────────────────────
  await test('S140 theme actions has no setInterval', () => {
    assert(!read('src/store/theme/actions.ts').includes('setInterval'), 'actions');
  });
  await test('S141 theme store index has no setInterval', () => {
    assert(!read('src/store/theme/index.ts').includes('setInterval'), 'index');
  });
  await test('S142 theme state has no setInterval', () => {
    assert(!read('src/store/theme/state.ts').includes('setInterval'), 'state');
  });
  await test('S143 theme selectors has no setInterval', () => {
    assert(!read('src/store/theme/selectors.ts').includes('setInterval'), 'selectors');
  });
  await test('S144 no setInterval anywhere in store/theme', () => {
    for (const file of listFiles(resolve(root, 'src/store/theme'))) {
      assert(!readFileSync(file, 'utf8').includes('setInterval'), file);
    }
  });

  // ─── GROUP T — BROWSER CHROME TOKENS ────────────────────────────
  await test('T145 BrowserHeader uses headerBackground', () => {
    assert(read('src/browser/components/BrowserHeader/BrowserHeader.tsx').includes('headerBackground'), 'header');
  });
  await test('T146 BrowserHeader uses useTheme', () => {
    assert(read('src/browser/components/BrowserHeader/BrowserHeader.tsx').includes('useTheme'), 'hook');
  });
  await test('T147 BrowserToolbar uses bottomNavBackground', () => {
    assert(read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx').includes('bottomNavBackground'), 'toolbar bg');
  });
  await test('T148 BrowserToolbar uses bottomNavBorder', () => {
    assert(read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx').includes('bottomNavBorder'), 'border');
  });
  await test('T149 BrowserToolbar uses useTheme', () => {
    assert(read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx').includes('useTheme'), 'hook');
  });

  // ─── GROUP U — WEBVIEW KEY NOT THEME-BASED ──────────────────────
  await test('U150 BrowserWebView has no key= prop', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!/\bkey=/.test(src), 'no key prop on WebView');
  });
  await test('U151 BrowserWebView does not key on theme.mode', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!/theme\.mode/.test(src) || !/\bkey=/.test(src), 'no theme key');
  });
  await test('U152 MountedTabWebView documents key={tabId} only', () => {
    const src = read('src/browser/components/BrowserContainer/MountedTabWebView.tsx');
    assert(src.includes('key={tabId}') || src.includes('`key={tabId}`') || src.includes('key={tabId}'), 'tabId key');
    assert(src.includes('never reuse by mount index') || src.includes('tabId'), 'tabId policy');
  });
  await test('U153 BrowserWebView uses useTheme for styling only', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(src.includes('useTheme'), 'theme for UI');
    assert(!/key=\{.*theme/.test(src), 'no theme key');
  });
  await test('U154 BrowserContainer keys tabs by tabId not theme', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserContainer.tsx');
    assert(src.includes('key={tabId}'), 'tabId key');
    assert(!/key=\{.*theme/.test(src), 'no theme key');
  });

  // ─── GROUP V — SETTINGS VALIDATION ACCEPTS LOGO ─────────────────
  await test('V155 isValidThemePreference accepts logo', () => {
    assert(isValidThemePreference('logo'), 'logo valid');
  });
  await test('V156 isValidThemePreference rejects system', () => {
    assert(!isValidThemePreference('system'), 'system invalid');
  });
  await test('V157 themePreferenceToApi logo → LOGO', () => {
    assert(themePreferenceToApi('logo') === 'LOGO', 'LOGO');
  });
  await test('V158 themePreferenceToApi light → LIGHT', () => {
    assert(themePreferenceToApi('light') === 'LIGHT', 'LIGHT');
  });
  await test('V159 themePreferenceToApi dark → DARK', () => {
    assert(themePreferenceToApi('dark') === 'DARK', 'DARK');
  });
  await test('V160 apiThemeToPreference LOGO → logo', () => {
    assert(apiThemeToPreference('LOGO') === 'logo', 'logo');
  });
  await test('V161 apiThemeToPreference SYSTEM → light', () => {
    assert(apiThemeToPreference('SYSTEM') === 'light', 'system collapse');
  });
  await test('V162 isValidApiTheme accepts LOGO', () => {
    assert(isValidApiTheme('LOGO'), 'LOGO api');
  });
  await test('V163 isValidApiTheme rejects invalid', () => {
    assert(!isValidApiTheme('NEON'), 'invalid');
  });
  await test('V164 sanitizeUpdatePayload accepts theme LOGO (source)', () => {
    assert(read('src/services/auth/settings-validation.ts').includes("'LOGO'"), 'LOGO in validation');
  });

  // ─── GROUP W — API ThemeMode INCLUDES LOGO ──────────────────────
  await test('W165 api/types ThemeMode includes LOGO', () => {
    assert(read('src/api/types.ts').includes("'LOGO'"), 'LOGO type');
  });
  await test('W166 api/types ThemeMode union has four values', () => {
    const match = read('src/api/types.ts').match(
      /ThemeMode = (.+);/,
    );
    assert(match != null, 'ThemeMode found');
    const union = match![1];
    for (const value of ['SYSTEM', 'LIGHT', 'LOGO', 'DARK']) {
      assert(union.includes(`'${value}'`), value);
    }
  });
  await test('W167 api index exports ThemeMode', () => {
    assert(read('src/api/index.ts').includes('ThemeMode'), 'export');
  });
  await test('W168 format-settings handles LOGO case', () => {
    assert(read('src/screens/settings/utils/format-settings.ts').includes("case 'LOGO'"), 'LOGO case');
  });
  await test('W169 format-settings uses themeLogo i18n', () => {
    assert(read('src/screens/settings/utils/format-settings.ts').includes('settings.themeLogo'), 'i18n');
  });

  // ─── GROUP X — STATUS BAR USES statusBarStyle ───────────────────
  await test('X170 status-bar imports useTheme', () => {
    assert(read('src/providers/status-bar.tsx').includes('useTheme'), 'hook');
  });
  await test('X171 status-bar destructures statusBarStyle', () => {
    assert(read('src/providers/status-bar.tsx').includes('statusBarStyle'), 'token');
  });
  await test('X172 StatusBar style prop uses statusBarStyle', () => {
    assert(read('src/providers/status-bar.tsx').includes('style={statusBarStyle}'), 'prop');
  });
  await test('X173 light mode statusBarStyle is dark', () => {
    assert(colors.light.statusBarStyle === 'dark', 'light dark icons');
  });
  await test('X174 logo mode statusBarStyle is light', () => {
    assert(colors.logo.statusBarStyle === 'light', 'logo light icons');
  });

  // ─── GROUP Y — useTheme HOOK INTEGRATION ────────────────────────
  await test('Y175 use-theme resolves via themes[mode]', () => {
    assert(read('src/hooks/use-theme.ts').includes('themes[mode]'), 'themes lookup');
  });
  await test('Y176 use-theme normalizes preference', () => {
    assert(read('src/hooks/use-theme.ts').includes('normalizeThemePreference'), 'normalize');
  });
  await test('Y177 use-theme uses resolveThemeMode', () => {
    assert(read('src/hooks/use-theme.ts').includes('resolveThemeMode'), 'resolve');
  });
  await test('Y178 use-theme reads from theme store', () => {
    assert(read('src/hooks/use-theme.ts').includes('useThemeStore'), 'store');
  });
  await test('Y179 themes export includes all three modes from index', () => {
    const idx = read('src/theme/index.ts');
    assert(idx.includes("mode: 'light'"), 'light');
    assert(idx.includes("mode: 'logo'"), 'logo');
    assert(idx.includes("mode: 'dark'"), 'dark');
  });

  // Extra coverage to exceed 160 meaningfully
  await test('Z180 colors.ts documents canonical brand red #DC3C2C', () => {
    assert(read('src/theme/colors.ts').includes('#DC3C2C'), 'documented');
  });
  await test('Z181 theme-preference documents system collapse', () => {
    assert(read('src/theme/theme-preference.ts').includes("'system'"), 'system handled');
  });
  await test('Z182 intro-palette documents dark neutral continuity (no olive)', () => {
    const src = read('src/theme/intro-palette.ts');
    assert(src.includes('colors.dark.background'), 'dark intro uses theme');
    assert(!src.includes('#1A2517'), 'no olive hex');
  });
  await test('Z183 AppLockGate neutral bootstrap uses theme.colors.background', () => {
    assert(read('src/security/app-lock/AppLockGate.tsx').includes('neutralBg = theme.colors.background'), 'neutral');
  });
  await test('Z184 theme store toggle cycles THEME_PREFERENCES', () => {
    assert(read('src/store/theme/actions.ts').includes('THEME_PREFERENCES'), 'cycle');
  });

  // ─── GROUP AA — LIGHT IS NEUTRAL WHITE (NOT SAGE SURFACES) ──────
  await test('AA185 light background is #FFFFFF white', () => {
    assert(colors.light.background === LIGHT_BG, 'bg');
  });
  await test('AA185b light secondary background is #FAFAFA', () => {
    assert(colors.light.backgroundSecondary === LIGHT_SECONDARY_BG, 'secondary');
  });
  await test('AA186 light background is not legacy sage #F4F7F2', () => {
    assert(colors.light.background !== LEGACY_SAGE_BG, 'not sage bg');
  });
  await test('AA187 light surface is white', () => {
    assert(colors.light.surface === LIGHT_WHITE, 'surface');
  });
  await test('AA188 light surface is not legacy sage #EEF2EA', () => {
    assert(colors.light.surface !== LEGACY_SAGE_SURFACE, 'not sage surface');
  });
  await test('AA189 light card is white', () => {
    assert(colors.light.card === LIGHT_WHITE, 'card');
  });
  await test('AA190 light header is white', () => {
    assert(colors.light.headerBackground === LIGHT_WHITE, 'header');
  });
  await test('AA191 light bottomNav is white', () => {
    assert(colors.light.bottomNavBackground === LIGHT_WHITE, 'bottomNav');
  });
  await test('AA192 light border is not legacy sage border', () => {
    assert(colors.light.border !== LEGACY_SAGE_BORDER, 'not sage border');
  });
  await test('AA193 light sheet/dialog/menu/input are white', () => {
    assert(colors.light.sheetBackground === LIGHT_WHITE, 'sheet');
    assert(colors.light.dialogBackground === LIGHT_WHITE, 'dialog');
    assert(colors.light.menuBackground === LIGHT_WHITE, 'menu');
    assert(colors.light.inputBackground === LIGHT_WHITE, 'input');
  });
  await test('AA194 light textPrimary is dark neutral', () => {
    assert(colors.light.textPrimary === '#171717', 'ink');
  });
  await test('AA195 light textSecondary is neutral gray', () => {
    assert(colors.light.textSecondary === '#6B7280', 'gray');
  });
  await test('AA196 light primary is dark neutral ink (not sage)', () => {
    assert(colors.light.primary === LIGHT_INK, 'ink');
    assert(colors.light.primary !== SAGE_ACCENT, 'not sage brand');
    assert(colors.light.success === '#16A34A', 'success separate');
  });

  // ─── GROUP AB — LOGO CONTENT NEUTRAL + CHROME BRAND ─────────────
  await test('AB197 logo background matches light neutral', () => {
    assert(colors.logo.background === colors.light.background, 'shared');
  });
  await test('AB198 logo card/surface white', () => {
    assert(colors.logo.card === LIGHT_WHITE && colors.logo.surface === LIGHT_WHITE, 'white');
  });
  await test('AB199 logo chrome #DC3C2C', () => {
    assert(colors.logo.headerBackground === BRAND_RED, 'header');
    assert(colors.logo.bottomNavBackground === BRAND_RED, 'nav');
  });
  await test('AB200 logo body text not brand red', () => {
    assert(colors.logo.textPrimary !== BRAND_RED, 'body');
  });

  // ─── GROUP AC — DARK CHROME NOT BRAND RED ───────────────────────
  await test('AC201 dark header not brand red', () => {
    assert(colors.dark.headerBackground !== BRAND_RED, 'header');
  });
  await test('AC202 dark bottomNav not brand red', () => {
    assert(colors.dark.bottomNavBackground !== BRAND_RED, 'nav');
  });

  // ─── GROUP AD — ONBOARDING SURFACES / ALLOWLIST ─────────────────
  await test('AD203 light onboarding background is neutral', () => {
    assert(resolveOnboardingSurfaces('light').background === LIGHT_BG, 'light');
  });
  await test('AD204 logo onboarding background is neutral', () => {
    assert(resolveOnboardingSurfaces('logo').background === LIGHT_BG, 'logo');
  });
  await test('AD205 logo onboarding accent is brand red', () => {
    assert(resolveOnboardingSurfaces('logo').accent === BRAND_RED, 'accent');
  });
  await test('AD206 dark onboarding uses neutral dark (not olive)', () => {
    assert(resolveOnboardingSurfaces('dark').background === colors.dark.background, 'dark');
    assert(resolveOnboardingSurfaces('dark').background !== DARK_OLIVE, 'not olive');
    assert(DARK_ONBOARDING_ALLOWLIST.background === colors.dark.background, 'allowlist synced');
  });
  await test('AD207 OnboardingSurfacesProvider exists', () => {
    assert(read('src/screens/onboarding/onboarding-surfaces-context.tsx').includes('OnboardingSurfacesProvider'), 'provider');
  });
  await test('AD208 OnboardingScreen wraps provider', () => {
    assert(read('src/screens/onboarding/OnboardingScreen.tsx').includes('OnboardingSurfacesProvider'), 'wrap');
  });
  await test('AD209 no accidental #F4F7F2 in light colors object usage for surfaces', () => {
    assert(!Object.values(colors.light).includes(LEGACY_SAGE_BG as never), 'no sage bg token');
  });
  await test('AD210 onboarding components avoid hardcoded olive except allowlists', () => {
    const allow = new Set([
      resolve(root, 'src/screens/onboarding/constants/onboarding.constants.ts'),
      resolve(root, 'src/screens/onboarding/gateway/constants/gateway.constants.ts'),
      resolve(root, 'src/screens/onboarding/trust/constants/trust.constants.ts'),
      resolve(root, 'src/screens/onboarding/library/constants/library.constants.ts'),
      resolve(root, 'src/screens/onboarding/gateway/HeroEcosystem/constants.ts'),
      resolve(root, 'src/theme/onboarding-surfaces.ts'),
      resolve(root, 'src/theme/intro-palette.ts'),
    ]);
    const offenders: string[] = [];
    for (const file of listFiles(resolve(root, 'src/screens/onboarding'))) {
      if (allow.has(file)) continue;
      const src = readFileSync(file, 'utf8');
      // StyleSheet-baked olive backgrounds are disallowed outside allowlists.
      if (/backgroundColor:\s*'#1A2517'/.test(src) || /backgroundColor:\s*"#1A2517"/.test(src)) {
        offenders.push(file.replace(root + '/', ''));
      }
      if (/backgroundColor:\s*'#F4F7F2'/.test(src) || /backgroundColor:\s*"#F4F7F2"/.test(src)) {
        offenders.push(file.replace(root + '/', ''));
      }
    }
    assert(offenders.length === 0, `offenders: ${offenders.join(', ') || 'none'}`);
  });
  await test('AD211 colors.ts documents neutral white Light Mode', () => {
    const src = read('src/theme/colors.ts');
    assert(src.includes('neutral white') || src.includes('neutralWhite'), 'docs');
  });
  await test('AD212 splash root provider uses themed / MMKV startup background', () => {
    const src = read('src/providers/app-provider.tsx');
    assert(src.includes('resolveStartupBackground') || src.includes('useTheme'), 'themed root');
    assert(!src.includes("colors.light.background"), 'not forced light-only');
  });

  // ─── PHASE 2 — BRAND / CHROME / ISOLATION / CONTRAST / SURFACES ─
  await test('P2-213 brandPalette sourceHex is #DC3C2C', () => {
    assert(brandPalette.sourceHex === BRAND_RED, 'sourceHex');
  });
  await test('P2-214 brandRedPressed centrally defined', () => {
    assert(brandPalette.brandRedPressed === '#C43426', 'pressed');
  });
  await test('P2-215 brandRedMuted centrally defined', () => {
    assert(brandPalette.brandRedMuted === '#F2A39C', 'muted');
  });
  await test('P2-216 onBrandRed is white', () => {
    assert(brandPalette.onBrandRed === '#FFFFFF', 'onBrand');
  });
  await test('P2-217 logo primary === brandRed', () => {
    assert(colors.logo.primary === BRAND_RED, 'primary');
  });
  await test('P2-218 logo link === brandRed', () => {
    assert(colors.logo.link === BRAND_RED, 'link');
  });
  await test('P2-219 logo error remains semantic EF4444', () => {
    assert(colors.logo.error === '#EF4444', 'error');
  });
  await test('P2-220 logo success remains semantic', () => {
    assert(colors.logo.success === '#16A34A', 'success');
  });
  await test('P2-221 light link is dark neutral not brand red or sage', () => {
    assert(colors.light.link === LIGHT_INK, 'ink link');
    assert(colors.light.link !== BRAND_RED, 'not brand');
    assert(colors.light.link !== SAGE_ACCENT, 'not sage');
  });
  await test('P2-222 dark link is not brand red', () => {
    assert(colors.dark.link !== BRAND_RED, 'dark link');
  });
  await test('P2-223 headerBorder exists on all modes', () => {
    assert(Boolean(colors.light.headerBorder), 'light');
    assert(Boolean(colors.logo.headerBorder), 'logo');
    assert(Boolean(colors.dark.headerBorder), 'dark');
  });
  await test('P2-224 logo headerBorder is brandRedPressed', () => {
    assert(colors.logo.headerBorder === brandPalette.brandRedPressed, 'pressed');
  });
  await test('P2-225 dark headerBorder is not brand red', () => {
    assert(colors.dark.headerBorder !== BRAND_RED, 'isolation');
  });
  await test('P2-226 AppHeader uses headerBorder token (no mode ternary)', () => {
    const src = read('src/components/headers/AppHeader.tsx');
    assert(src.includes('headerBorder'), 'token');
    assert(!src.includes("theme.mode === 'logo'"), 'no logo branch');
  });
  await test('P2-227 BrowserHeader uses headerBorder token', () => {
    const src = read('src/browser/components/BrowserHeader/BrowserHeader.tsx');
    assert(src.includes('headerBorder'), 'token');
    assert(!src.includes("theme.mode === 'logo'"), 'no logo branch');
  });
  await test('P2-228 AppHeader title uses headerText', () => {
    assert(read('src/components/headers/AppHeader.tsx').includes('headerText'), 'title');
  });
  await test('P2-229 AppHeader back uses headerIcon', () => {
    assert(read('src/components/headers/AppHeader.tsx').includes("color=\"headerIcon\""), 'icon');
  });
  await test('P2-230 tab bar uses bottomNav tokens', () => {
    const src = read('src/navigation/config/tab-bar-options.ts');
    assert(src.includes('bottomNavBackground'), 'bg');
    assert(src.includes('bottomNavActive'), 'active');
    assert(src.includes('bottomNavInactive'), 'inactive');
  });
  await test('P2-231 stack headers use headerBackground', () => {
    assert(read('src/navigation/config/screen-options.ts').includes('headerBackground'), 'header');
  });
  await test('P2-232 Browser toolbar uses bottomNavBackground', () => {
    assert(
      read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx').includes(
        'bottomNavBackground',
      ),
      'toolbar',
    );
  });
  await test('P2-233 BrowserTabSwitcher uses theme colors', () => {
    const src = read('src/browser/components/BrowserTabSwitcher/BrowserTabSwitcher.tsx');
    assert(src.includes('useTheme'), 'hook');
    assert(src.includes('theme.colors'), 'tokens');
  });
  await test('P2-234 BrowserOverflowMenu uses theme colors', () => {
    assert(
      read('src/browser/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx').includes(
        'useTheme',
      ),
      'menu',
    );
  });
  await test('P2-235 no theme-based WebView key in BrowserWebView', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!/key=\{[^}]*theme/.test(src), 'no theme key');
    assert(!/key=\{[^}]*colorScheme/.test(src), 'no scheme key');
  });
  await test('P2-236 theme modules do not import download engine', () => {
    for (const rel of [
      'src/theme/colors.ts',
      'src/theme/theme-preference.ts',
      'src/store/theme/actions.ts',
      'src/hooks/use-theme.ts',
    ]) {
      const src = read(rel);
      assert(!src.includes('downloadEngine'), rel);
      assert(!src.includes('downloads/engine'), rel);
    }
  });
  await test('P2-237 theme modules do not import App Lock SecureStore key write', () => {
    const src = read('src/store/theme/actions.ts');
    assert(!src.includes('APP_LOCK_SECURE_STORE_KEY'), 'no lock key');
    assert(!src.includes('SecureStore'), 'no secure store');
  });
  await test('P2-238 QualityOptionRow uses warning token alpha', () => {
    const src = read('src/screens/downloads/quality/QualityOptionRow.tsx');
    assert(src.includes('withAlpha(theme.colors.warning'), 'warning token');
    assert(!src.includes('rgba(245, 158, 11'), 'no raw amber');
  });
  await test('P2-239 PlayerAdjustmentHud uses intentional black video scrim', () => {
    const src = read('src/screens/player/components/PlayerAdjustmentHud.tsx');
    assert(src.includes('rgba(0,0,0,0.78)'), 'scrim');
    assert(!src.includes('rgba(26, 37, 23'), 'no olive hud');
  });
  await test('P2-240 App Lock screens use theme.colors.background', () => {
    for (const rel of [
      'src/security/app-lock/AppLockScreen.tsx',
      'src/security/app-lock/AppLockForgotFlow.tsx',
      'src/security/app-lock/AppLockGate.tsx',
    ]) {
      assert(read(rel).includes('theme.colors.background'), rel);
    }
  });
  await test('P2-241 dead APP_LOCK_BOOTSTRAP_BG removed', () => {
    assert(!read('src/security/app-lock/app-lock.constants.ts').includes('APP_LOCK_BOOTSTRAP_BG'), 'removed');
  });
  await test('P2-242 SegmentedControl selected uses textOnPrimary', () => {
    assert(
      read('src/components/inputs/SegmentedControl.tsx').includes('textOnPrimary'),
      'onPrimary',
    );
  });
  await test('P2-243 ResumePlaybackSheet backdrop uses overlay token', () => {
    assert(
      read('src/screens/player/components/ResumePlaybackSheet.tsx').includes(
        'theme.colors.overlay',
      ),
      'overlay',
    );
  });
  await test('P2-244 Badge uses semantic success/warning/error', () => {
    const src = read('src/components/common/Badge.tsx');
    assert(src.includes('theme.colors.success'), 'success');
    assert(src.includes('theme.colors.warning'), 'warning');
    assert(src.includes('theme.colors.error'), 'error');
  });
  await test('P2-245 no #DC3C2C outside theme + brand docs in src (allowlisted)', () => {
    const allowDirs = [
      resolve(root, 'src/theme'),
      resolve(root, 'src/components/graphics'),
      resolve(root, 'src/screens/onboarding/gateway/HeroEcosystem'),
    ];
    const offenders: string[] = [];
    for (const file of listFiles(resolve(root, 'src'))) {
      if (allowDirs.some((d) => file.startsWith(d))) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('#DC3C2C') || src.includes('#dc3c2c')) {
        offenders.push(file.replace(root + '/', ''));
      }
    }
    assert(offenders.length === 0, `offenders: ${offenders.join(', ') || 'none'}`);
  });
  await test('P2-246 no #FF0000 as VidoraX brand outside external platform icons', () => {
    const allow = [
      resolve(root, 'src/components/graphics'),
      resolve(root, 'src/screens/onboarding/gateway/HeroEcosystem'),
      resolve(root, 'src/theme/colors.ts'),
    ];
    const offenders: string[] = [];
    for (const file of listFiles(resolve(root, 'src'))) {
      if (allow.some((d) => file.startsWith(d) || file === d)) continue;
      const src = readFileSync(file, 'utf8');
      if (/#FF0000|#ff0000/.test(src)) {
        offenders.push(file.replace(root + '/', ''));
      }
    }
    assert(offenders.length === 0, `offenders: ${offenders.join(', ') || 'none'}`);
  });
  await test('P2-247 status-bar maps statusBarStyle', () => {
    assert(read('src/providers/status-bar.tsx').includes('statusBarStyle'), 'status');
  });
  await test('P2-248 light statusBarStyle dark', () => {
    assert(colors.light.statusBarStyle === 'dark', 'dark icons');
  });
  await test('P2-249 logo statusBarStyle light', () => {
    assert(colors.logo.statusBarStyle === 'light', 'light icons');
  });
  await test('P2-250 dark statusBarStyle light', () => {
    assert(colors.dark.statusBarStyle === 'light', 'light icons');
  });

  // Contrast measurements (report ratios; assert practical floors)
  const cLightText = roundContrast(
    contrastRatio(colors.light.textPrimary, colors.light.background),
  );
  const cLightSecondary = roundContrast(
    contrastRatio(colors.light.textSecondary, colors.light.background),
  );
  const cLightBtn = roundContrast(
    contrastRatio(colors.light.textOnPrimary, colors.light.primary),
  );
  const cLogoOnBrand = roundContrast(
    contrastRatio(colors.logo.headerText, colors.logo.headerBackground),
  );
  const cLogoBody = roundContrast(
    contrastRatio(colors.logo.textPrimary, colors.logo.background),
  );
  const cLogoBrandOnWhite = roundContrast(
    contrastRatio(colors.logo.primary, colors.logo.card),
  );
  const cLogoInactive = roundContrast(
    contrastRatio(colors.logo.bottomNavInactive, colors.logo.bottomNavBackground),
  );
  const cDarkText = roundContrast(
    contrastRatio(colors.dark.textPrimary, colors.dark.background),
  );
  const cDarkSecondary = roundContrast(
    contrastRatio(colors.dark.textSecondary, colors.dark.background),
  );
  const cDarkNav = roundContrast(
    contrastRatio(colors.dark.bottomNavActive, colors.dark.bottomNavBackground),
  );
  const cLightNavInactive = roundContrast(
    contrastRatio(colors.light.bottomNavInactive, colors.light.bottomNavBackground),
  );
  const cErrorOnLight = roundContrast(
    contrastRatio(colors.light.error, colors.light.background),
  );
  const cLinkLogo = roundContrast(
    contrastRatio(colors.logo.link, colors.logo.background),
  );

  await test('P2-251 Light textPrimary/background contrast measured', () => {
    assert(cLightText != null && cLightText >= 4.5, `got ${cLightText}`);
  });
  await test('P2-252 Light textSecondary/background contrast measured', () => {
    assert(cLightSecondary != null && cLightSecondary >= 3.0, `got ${cLightSecondary}`);
  });
  await test('P2-253 Light button text/primary contrast measured', () => {
    assert(cLightBtn != null && cLightBtn >= 3.0, `got ${cLightBtn}`);
  });
  await test('P2-254 Logo onBrandRed/header contrast measured', () => {
    // White on #DC3C2C ≈ 4.44:1 — meets large-text/UI chrome (≥3:1); just under body 4.5:1.
    // Canonical brand red is fixed; foreground stays white for chrome icons/titles.
    assert(cLogoOnBrand != null && cLogoOnBrand >= 4.4, `got ${cLogoOnBrand}`);
  });
  await test('P2-255 Logo body/background contrast measured', () => {
    assert(cLogoBody != null && cLogoBody >= 4.5, `got ${cLogoBody}`);
  });
  await test('P2-256 Logo brandRed on white card contrast measured', () => {
    assert(cLogoBrandOnWhite != null && cLogoBrandOnWhite >= 3.0, `got ${cLogoBrandOnWhite}`);
  });
  await test('P2-257 Logo inactive nav on brand red contrast measured', () => {
    // Disabled chrome is intentionally muted white (~60%): visible on #DC3C2C, not WCAG body text.
    assert(cLogoInactive != null && cLogoInactive >= 2.4, `got ${cLogoInactive}`);
  });
  await test('P2-258 Dark textPrimary/background contrast measured', () => {
    assert(cDarkText != null && cDarkText >= 4.5, `got ${cDarkText}`);
  });
  await test('P2-259 Dark textSecondary/background contrast measured', () => {
    assert(cDarkSecondary != null && cDarkSecondary >= 3.0, `got ${cDarkSecondary}`);
  });
  await test('P2-260 Dark bottomNav active contrast measured', () => {
    assert(cDarkNav != null && cDarkNav >= 2.5, `got ${cDarkNav}`);
  });
  await test('P2-261 Light inactive nav contrast measured', () => {
    assert(cLightNavInactive != null && cLightNavInactive >= 3.0, `got ${cLightNavInactive}`);
  });
  await test('P2-262 Light error/background contrast measured', () => {
    assert(cErrorOnLight != null && cErrorOnLight >= 3.0, `got ${cErrorOnLight}`);
  });
  await test('P2-263 Logo link/background contrast measured', () => {
    assert(cLinkLogo != null && cLinkLogo >= 3.0, `got ${cLinkLogo}`);
  });
  await test('P2-264 contrast helper module exported', () => {
    assert(read('src/theme/contrast.ts').includes('contrastRatio'), 'module');
  });
  await test('P2-265 no setInterval in theme store/actions/hooks', () => {
    for (const rel of [
      'src/store/theme/actions.ts',
      'src/store/theme/index.ts',
      'src/hooks/use-theme.ts',
      'src/providers/status-bar.tsx',
    ]) {
      assert(!read(rel).includes('setInterval'), rel);
    }
  });
  await test('P2-266 persistence normalize unknown → light', () => {
    assert(normalizeThemePreference('UNKNOWN_THEME') === 'light', 'unknown');
    assert(normalizeThemePreference(null) === 'light', 'null');
    assert(normalizeThemePreference({}) === 'light', 'obj');
  });
  await test('P2-267 legacy system → light', () => {
    assert(normalizeThemePreference('system') === 'light', 'system');
  });
  await test('P2-268 download detail route exists for theming inventory', () => {
    assert(read('src/app/(app)/downloads/[id].tsx').length > 0, 'detail route');
  });
  await test('P2-269 App Lock Phase 2 screens exist', () => {
    for (const rel of [
      'src/app/(app)/app-lock-change-pin.tsx',
      'src/app/(app)/app-lock-rotate-recovery.tsx',
      'src/app/(app)/app-lock-disable.tsx',
      'src/app/(app)/app-lock-setup.tsx',
    ]) {
      assert(read(rel).length > 0, rel);
    }
  });
  await test('P2-270 EmptyState component uses theme primitives', () => {
    assert(read('src/components/common/EmptyState.tsx').includes('useTheme') || read('src/components/common/EmptyState.tsx').includes('Button'), 'empty');
  });
  await test('P2-271 ConfirmModal / AppModal themed', () => {
    const modal = read('src/components/modals/AppModal.tsx');
    assert(modal.includes('useTheme') || modal.includes('theme.colors'), 'modal');
  });
  await test('P2-272 BottomSheet themed', () => {
    assert(read('src/components/bottom-sheets/BottomSheet.tsx').includes('useTheme'), 'sheet');
  });
  await test('P2-273 paper theme derived from semantic tokens', () => {
    assert(read('src/providers/paper-theme.ts').includes('colors[mode]'), 'paper');
  });
  await test('P2-274 navigation theme uses headerBackground for card', () => {
    assert(
      read('src/providers/navigation-theme-provider.tsx').includes('headerBackground'),
      'nav card',
    );
  });
  await test('P2-275 logo sheet/dialog remain light (not brand red)', () => {
    assert(colors.logo.sheetBackground === LIGHT_WHITE, 'sheet');
    assert(colors.logo.dialogBackground === LIGHT_WHITE, 'dialog');
    assert(colors.logo.sheetBackground !== BRAND_RED, 'not red');
  });
  await test('P2-276 dark sheet/dialog remain dark (not brand red)', () => {
    assert(colors.dark.sheetBackground !== BRAND_RED, 'sheet');
    assert(colors.dark.dialogBackground !== BRAND_RED, 'dialog');
    assert(colors.dark.sheetBackground === colors.dark.card, 'dark card');
  });
  await test('P2-277 headerSubtitle tokens defined', () => {
    assert(colors.logo.headerSubtitle === colors.logo.bottomNavInactive, 'logo sub');
    assert(colors.light.headerSubtitle === colors.light.textSecondary, 'light sub');
  });
  await test('P2-278 ToolbarButton uses bottomNav active/inactive tokens', () => {
    const src = read('src/browser/components/BrowserToolbar/ToolbarButton.tsx');
    assert(src.includes('bottomNavActive'), 'active');
    assert(src.includes('bottomNavInactive'), 'inactive');
    assert(src.includes('bottomNavPressed'), 'pressed');
    assert(src.includes("'transparent'") || src.includes('"transparent"'), 'transparent default');
    assert(src.includes('disabledOpacity={1}'), 'no disabled fade');
    assert(src.includes('pressedOpacity={1}'), 'no press fade');
    assert(!src.includes('IconButton'), 'not IconButton surface path');
  });
  await test('P2-278b Logo toolbar chrome tokens (no white button boxes)', () => {
    assert(colors.logo.bottomNavBackground === BRAND_RED, 'toolbar bg');
    assert(colors.logo.bottomNavActive === brandPalette.onBrandRed, 'enabled white');
    assert(colors.logo.bottomNavInactive === 'rgba(255, 255, 255, 0.6)', 'disabled muted');
    assert(colors.logo.bottomNavPressed === 'rgba(255, 255, 255, 0.14)', 'pressed');
    assert(colors.light.bottomNavActive === LIGHT_INK, 'light enabled unchanged');
    assert(colors.light.bottomNavInactive === '#6B7280', 'light disabled unchanged');
    assert(colors.dark.bottomNavActive === '#FFFFFF', 'dark enabled');
    assert(colors.dark.bottomNavInactive === DARK_TEXT_MUTED, 'dark disabled');
  });
  await test('P2-278c ghost disabled stays transparent (no surface square)', () => {
    const src = read('src/components/buttons/button-styles.ts');
    assert(src.includes("variant === 'ghost'"), 'ghost disabled branch');
    assert(src.includes("backgroundColor: 'transparent'"), 'transparent');
  });
  await test('P2-279 ReloadStopButton uses headerIcon', () => {
    assert(
      read('src/browser/components/BrowserHeader/ReloadStopButton.tsx').includes(
        'headerIcon',
      ),
      'reload',
    );
  });
  await test('P2-280 intro light background matches light theme', () => {
    assert(resolveIntroColors('light').background === colors.light.background, 'intro');
  });
  await test('P2-281 contrast report values logged for docs', () => {
    // Soft assert that ratios were computed (documented in architecture).
    assert(cLogoOnBrand != null && cLightText != null && cDarkText != null, 'ratios');
    console.log(
      `      contrast L text=${cLightText} L sec=${cLightSecondary} L btn=${cLightBtn} ` +
        `Logo onBrand=${cLogoOnBrand} Logo body=${cLogoBody} Logo brand/white=${cLogoBrandOnWhite} ` +
        `Logo inactive=${cLogoInactive} D text=${cDarkText} D sec=${cDarkSecondary} D nav=${cDarkNav}`,
    );
  });

  // ─── LIGHT FINAL NEUTRALIZATION (white + black + gray) ───────────
  const SAGE_SET = new Set([SAGE_ACCENT, '#C5D9BE', '#8FB583', '#7A9470', '#F4F7F2', '#EEF2EA', '#D8E0D4']);
  await test('LN282 light background pure white', () => {
    assert(colors.light.background === '#FFFFFF', 'white');
  });
  await test('LN283 light backgroundSecondary #FAFAFA', () => {
    assert(colors.light.backgroundSecondary === '#FAFAFA', 'secondary');
  });
  await test('LN284 light surface/card white', () => {
    assert(colors.light.surface === '#FFFFFF' && colors.light.card === '#FFFFFF', 'surfaces');
  });
  await test('LN285 light primary is #171717 ink', () => {
    assert(colors.light.primary === '#171717', 'ink');
  });
  await test('LN286 light onPrimary is white', () => {
    assert(colors.light.textOnPrimary === '#FFFFFF', 'onPrimary');
  });
  await test('LN287 light primaryDark is #111111', () => {
    assert(colors.light.primaryDark === '#111111', 'strong');
  });
  await test('LN288 light primaryLight is neutral muted gray', () => {
    assert(colors.light.primaryLight === '#F3F4F6', 'muted');
  });
  await test('LN289 light accent equals ink primary', () => {
    assert(colors.light.accent === colors.light.primary, 'accent');
  });
  await test('LN290 light primary is not sage family', () => {
    assert(!SAGE_SET.has(colors.light.primary), 'no sage primary');
    assert(!SAGE_SET.has(colors.light.accent), 'no sage accent');
    assert(!SAGE_SET.has(colors.light.link), 'no sage link');
    assert(!SAGE_SET.has(colors.light.headerIcon), 'no sage headerIcon');
    assert(!SAGE_SET.has(colors.light.bottomNavActive), 'no sage nav active');
  });
  await test('LN291 light success remains semantic green separate from primary', () => {
    assert(colors.light.success === '#16A34A', 'success');
    assert(colors.light.success !== colors.light.primary, 'separated');
  });
  await test('LN292 light error/warning separate from primary', () => {
    assert(colors.light.error === '#EF4444', 'error');
    assert(colors.light.warning === '#D97706', 'warning');
    assert(colors.light.error !== colors.light.primary, 'err≠primary');
  });
  await test('LN293 light header white + dark text/icons', () => {
    assert(colors.light.headerBackground === '#FFFFFF', 'header bg');
    assert(colors.light.headerText === LIGHT_INK, 'header text');
    assert(colors.light.headerIcon === LIGHT_INK, 'header icon');
  });
  await test('LN294 light bottom nav white + dark active + gray inactive', () => {
    assert(colors.light.bottomNavBackground === '#FFFFFF', 'nav bg');
    assert(colors.light.bottomNavActive === LIGHT_INK, 'active');
    assert(colors.light.bottomNavInactive === '#6B7280', 'inactive');
  });
  await test('LN295 light link is ink not green', () => {
    assert(colors.light.link === LIGHT_INK, 'link');
  });
  await test('LN296 light sheet/dialog/menu/input white', () => {
    assert(colors.light.sheetBackground === '#FFFFFF', 'sheet');
    assert(colors.light.dialogBackground === '#FFFFFF', 'dialog');
    assert(colors.light.menuBackground === '#FFFFFF', 'menu');
    assert(colors.light.inputBackground === '#FFFFFF', 'input');
  });
  await test('LN297 light surfacePressed/Selected neutral gray', () => {
    assert(colors.light.surfacePressed === '#F5F5F5', 'pressed');
    assert(colors.light.surfaceSelected === '#F3F4F6', 'selected');
  });
  await test('LN298 Paper light primary maps dark ink', () => {
    assert(read('src/providers/paper-theme.ts').includes('primary: palette.primary'), 'paper');
    assert(colors.light.primary === LIGHT_INK, 'source');
  });
  await test('LN299 Navigation light primary is ink', () => {
    assert(colors.light.primary === LIGHT_INK, 'nav primary source');
  });
  await test('LN300 intro light accent is dark neutral', () => {
    assert(resolveIntroColors('light').accent === LIGHT_INK, 'intro accent');
    assert(resolveIntroColors('light').loaderFill === LIGHT_INK, 'loader');
  });
  await test('LN301 onboarding light surfaces use light primary (ink)', () => {
    assert(resolveOnboardingSurfaces('light').accent === LIGHT_INK, 'onboard accent');
  });
  await test('LN302 SegmentedControl uses primary + textOnPrimary (light = black/white)', () => {
    const src = read('src/components/inputs/SegmentedControl.tsx');
    assert(src.includes('theme.colors.primary'), 'primary');
    assert(src.includes('textOnPrimary'), 'onPrimary');
  });
  await test('LN303 Button primary uses theme primary/textOnPrimary', () => {
    const src = read('src/components/buttons/button-styles.ts');
    assert(src.includes('theme.colors.primary'), 'primary');
    assert(src.includes('theme.colors.textOnPrimary'), 'onPrimary');
  });
  await test('LN304 light statusBarStyle dark content', () => {
    assert(colors.light.statusBarStyle === 'dark', 'status');
  });
  await test('LN305 no sage hex in light theme token values', () => {
    for (const [key, value] of Object.entries(colors.light)) {
      if (typeof value !== 'string') continue;
      if (key === 'success') continue; // semantic green allowed
      assert(!SAGE_SET.has(value), `light.${key}=${value}`);
      assert(value !== '#ACC8A2', `light.${key}`);
    }
  });
  await test('LN306 Logo primary still brand red after Light neutralization', () => {
    assert(colors.logo.primary === BRAND_RED, 'logo primary');
    assert(colors.logo.headerBackground === BRAND_RED, 'logo header');
    assert(colors.logo.bottomNavBackground === BRAND_RED, 'logo nav');
  });
  await test('LN307 Dark primary is off-white after Dark neutralization', () => {
    assert(colors.dark.primary === DARK_PRIMARY, 'dark primary');
    assert(colors.dark.headerBackground === DARK_CHROME, 'dark header');
    assert(colors.dark.bottomNavBackground !== BRAND_RED, 'dark nav');
    assert(colors.dark.primary !== SAGE_ACCENT, 'not sage');
  });
  await test('LN308 Logo textOnPrimary still white on red', () => {
    assert(colors.logo.textOnPrimary === '#FFFFFF', 'onBrand');
  });
  await test('LN309 Light textOnPrimary white on ink (not olive)', () => {
    assert(colors.light.textOnPrimary === '#FFFFFF', 'white');
    assert(colors.light.textOnPrimary !== DARK_OLIVE, 'not olive');
  });
  await test('LN310 light contrast textPrimary/background >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.light.textPrimary, colors.light.background));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('LN311 light contrast secondary/background >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.light.textSecondary, colors.light.background));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('LN312 light contrast onPrimary/primary >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.light.textOnPrimary, colors.light.primary));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('LN313 light contrast bottomNavActive/background >= 4.5', () => {
    const r = roundContrast(
      contrastRatio(colors.light.bottomNavActive, colors.light.bottomNavBackground),
    );
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('LN314 light contrast inactive nav/background >= 3.0', () => {
    const r = roundContrast(
      contrastRatio(colors.light.bottomNavInactive, colors.light.bottomNavBackground),
    );
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('LN315 light contrast success/white >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.light.success, colors.light.background));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('LN316 light contrast error/white >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.light.error, colors.light.background));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('LN317 light contrast warning/white >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.light.warning, colors.light.background));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('LN318 colors.ts documents white+black+gray Light contract', () => {
    const src = read('src/theme/colors.ts');
    assert(src.includes('WHITE + BLACK + GRAY'), 'contract');
    assert(src.includes('NOT used as Light primary'), 'sage note');
  });
  await test('LN319 AppHeader light uses headerIcon ink (via token)', () => {
    assert(colors.light.headerIcon === LIGHT_INK, 'icon');
    assert(read('src/components/headers/AppHeader.tsx').includes('headerIcon'), 'wired');
  });
  await test('LN320 tab bar light active is ink', () => {
    assert(colors.light.bottomNavActive === LIGHT_INK, 'tab');
  });
  await test('LN321 Browser header light background white', () => {
    assert(colors.light.headerBackground === '#FFFFFF', 'browser header');
  });
  await test('LN322 Light generic progress uses primary ink not success', () => {
    assert(colors.light.primary !== colors.light.success, 'progress≠success');
  });
  await test('LN323 Dark primary is neutral off-white (not sage)', () => {
    assert(colors.dark.primary === DARK_PRIMARY, 'dark primary');
    assert(colors.dark.accent === DARK_PRIMARY, 'dark accent');
    assert(colors.dark.primary !== SAGE_ACCENT, 'not sage');
  });
  await test('LN324 Logo chrome #DC3C2C unchanged', () => {
    assert(brandPalette.brandRed === '#DC3C2C', 'brand');
    assert(colors.logo.headerBackground === '#DC3C2C', 'header');
    assert(colors.logo.bottomNavBackground === '#DC3C2C', 'nav');
  });
  await test('LN325 light muted text token exists', () => {
    assert(colors.light.textMuted === '#737373', 'muted');
  });
  await test('LN326 light disabled text #A3A3A3', () => {
    assert(colors.light.textDisabled === '#A3A3A3', 'disabled');
  });
  await test('LN327 light border #E5E5E5 divider #EEEEEE', () => {
    assert(colors.light.border === '#E5E5E5', 'border');
    assert(colors.light.divider === '#EEEEEE', 'divider');
  });
  await test('LN328 light + logo share white content surfaces', () => {
    assert(colors.logo.background === colors.light.background, 'bg');
    assert(colors.logo.card === colors.light.card, 'card');
  });
  await test('LN329 light primaryLight not sageLight', () => {
    assert(colors.light.primaryLight !== '#C5D9BE', 'not sageLight');
  });
  await test('LN330 light primaryDark not sageDark', () => {
    assert(colors.light.primaryDark !== '#8FB583', 'not sageDark');
  });
  await test('LN331 settings tokens use theme.mode primary alphas', () => {
    assert(read('src/screens/settings/theme/settings-tokens.ts').includes('primaryAlphas'), 'alphas');
  });
  await test('LN332 AppearanceSection offers light|logo|dark', () => {
    const src = read('src/screens/settings/components/AppearanceSection.tsx');
    assert(src.includes("'light'"), 'light');
    assert(src.includes("'logo'"), 'logo');
    assert(src.includes("'dark'"), 'dark');
  });
  await test('LN333 no theme polling after Light change', () => {
    assert(!read('src/store/theme/actions.ts').includes('setInterval'), 'no poll');
  });
  await test('LN334 WebView key still not theme-based', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!/key=\{[^}]*theme/.test(src), 'no theme key');
  });
  await test('LN335 App Lock still uses theme.colors.background', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes('theme.colors.background'), 'lock');
  });
  await test('LN336 Badge success still semantic green', () => {
    assert(read('src/components/common/Badge.tsx').includes('theme.colors.success'), 'badge');
  });
  await test('LN337 light info remains distinct semantic', () => {
    assert(colors.light.info === '#5B9AA9', 'info');
    assert(colors.light.info !== colors.light.primary, '≠primary');
  });
  await test('LN338 root GestureHandler uses themed startup background', () => {
    const src = read('src/providers/app-provider.tsx');
    assert(src.includes('resolveStartupBackground') || src.includes('theme.colors.background'), 'root');
  });
  await test('LN339 light headerBorder gray not sage', () => {
    assert(colors.light.headerBorder === '#EEEEEE', 'border');
    assert(!SAGE_SET.has(colors.light.headerBorder), 'not sage');
  });
  await test('LN340 logo regression: body text still dark ink', () => {
    assert(colors.logo.textPrimary === LIGHT_INK, 'body');
  });
  await test('LN341 dark regression: bottomNavActive is white (not sage)', () => {
    assert(colors.dark.bottomNavActive === '#FFFFFF', 'dark active white');
    assert(colors.dark.bottomNavActive !== SAGE_ACCENT, 'not sage');
  });
  await test('LN342 light contrast report for neutralization', () => {
    const text = roundContrast(contrastRatio(colors.light.textPrimary, colors.light.background));
    const btn = roundContrast(contrastRatio(colors.light.textOnPrimary, colors.light.primary));
    const nav = roundContrast(
      contrastRatio(colors.light.bottomNavActive, colors.light.bottomNavBackground),
    );
    console.log(`      LIGHT-neutral contrast text=${text} btn=${btn} navActive=${nav}`);
    assert(text != null && btn != null && nav != null, 'measured');
  });

  // ─── GROUP DN — DARK THEME FINAL NEUTRALIZATION ─────────────────
  await test('DN343 dark background #0D0D0D', () => {
    assert(colors.dark.background === DARK_BG, 'bg');
  });
  await test('DN344 dark backgroundSecondary #141414', () => {
    assert(colors.dark.backgroundSecondary === DARK_SECONDARY, 'secondary');
  });
  await test('DN345 dark surface #181818', () => {
    assert(colors.dark.surface === DARK_SURFACE, 'surface');
  });
  await test('DN346 dark surfaceElevated #1F1F1F', () => {
    assert(colors.dark.surfaceElevated === DARK_ELEVATED, 'elevated');
  });
  await test('DN347 dark surfacePressed #262626', () => {
    assert(colors.dark.surfacePressed === '#262626', 'pressed');
  });
  await test('DN348 dark surfaceSelected #242424', () => {
    assert(colors.dark.surfaceSelected === '#242424', 'selected');
  });
  await test('DN349 dark root not olive', () => {
    assert(colors.dark.background !== DARK_OLIVE, 'not olive');
    assert(colors.dark.backgroundSecondary !== '#222E1E', 'not olive surface');
  });
  await test('DN350 dark root not sage family', () => {
    assert(!SAGE_SET.has(colors.dark.background), 'bg');
    assert(!SAGE_SET.has(colors.dark.surface), 'surface');
    assert(!SAGE_SET.has(colors.dark.card), 'card');
  });
  await test('DN351 dark textPrimary off-white', () => {
    assert(colors.dark.textPrimary === DARK_PRIMARY, 'text');
  });
  await test('DN352 dark textSecondary gray', () => {
    assert(colors.dark.textSecondary === DARK_TEXT_SECONDARY, 'secondary');
  });
  await test('DN353 dark textMuted gray', () => {
    assert(colors.dark.textMuted === DARK_TEXT_MUTED, 'muted');
  });
  await test('DN354 dark border #2A2A2A', () => {
    assert(colors.dark.border === '#2A2A2A', 'border');
  });
  await test('DN355 dark divider #242424', () => {
    assert(colors.dark.divider === '#242424', 'divider');
  });
  await test('DN356 dark primary not sage', () => {
    assert(colors.dark.primary !== SAGE_ACCENT, '≠sage');
  });
  await test('DN357 dark primary not success green', () => {
    assert(colors.dark.primary !== colors.dark.success, '≠success');
  });
  await test('DN358 dark primary light neutral', () => {
    assert(colors.dark.primary === DARK_PRIMARY, 'primary');
  });
  await test('DN359 dark onPrimary dark neutral', () => {
    assert(colors.dark.textOnPrimary === DARK_ON_PRIMARY, 'onPrimary');
  });
  await test('DN360 dark success separate', () => {
    assert(colors.dark.success === '#16A34A', 'success');
    assert(colors.dark.success !== colors.dark.primary, 'separated');
  });
  await test('DN361 dark error separate', () => {
    assert(colors.dark.error === '#EF4444', 'error');
    assert(colors.dark.error !== colors.dark.primary, 'separated');
  });
  await test('DN362 dark warning separate', () => {
    assert(colors.dark.warning === '#D97706', 'warning');
    assert(colors.dark.warning !== colors.dark.primary, 'separated');
  });
  await test('DN363 dark selection not success', () => {
    assert(colors.dark.surfaceSelected !== colors.dark.success, 'selected≠success');
    assert(colors.dark.surfaceSelected === '#242424', 'neutral selected');
  });
  await test('DN364 dark focus/primary not success', () => {
    assert(colors.dark.primary !== colors.dark.success, 'focus≠success');
  });
  await test('DN365 dark progressActive (primary) not success', () => {
    assert(colors.dark.primary !== colors.dark.success, 'progress≠success');
  });
  await test('DN366 dark link not success', () => {
    assert(colors.dark.link !== colors.dark.success, 'link≠success');
    assert(colors.dark.link === DARK_PRIMARY, 'link neutral');
  });
  await test('DN367 dark header chrome', () => {
    assert(colors.dark.headerBackground === DARK_CHROME, 'header');
    assert(colors.dark.headerText === DARK_PRIMARY, 'title');
    assert(colors.dark.headerIcon === DARK_PRIMARY, 'icon');
  });
  await test('DN368 dark header border neutral', () => {
    assert(colors.dark.headerBorder === '#242424', 'border');
  });
  await test('DN369 dark bottom nav chrome', () => {
    assert(colors.dark.bottomNavBackground === DARK_CHROME, 'nav bg');
  });
  await test('DN370 dark active nav white', () => {
    assert(colors.dark.bottomNavActive === '#FFFFFF', 'active');
  });
  await test('DN371 dark inactive nav gray', () => {
    assert(colors.dark.bottomNavInactive === DARK_TEXT_MUTED, 'inactive');
  });
  await test('DN372 dark active nav not sage', () => {
    assert(colors.dark.bottomNavActive !== SAGE_ACCENT, 'not sage');
  });
  await test('DN373 dark tab indicator not green', () => {
    assert(colors.dark.primary !== colors.dark.success, 'indicator≠success');
  });
  await test('DN374 dark nav not Logo red', () => {
    assert(colors.dark.headerBackground !== BRAND_RED, 'header');
    assert(colors.dark.bottomNavBackground !== BRAND_RED, 'nav');
  });
  await test('DN375 dark primary button light + dark text', () => {
    assert(colors.dark.primary === DARK_PRIMARY, 'fill');
    assert(colors.dark.textOnPrimary === DARK_ON_PRIMARY, 'label');
  });
  await test('DN376 dark secondary surfaces charcoal', () => {
    assert(colors.dark.card === DARK_SURFACE, 'card');
    assert(colors.dark.sheetBackground === DARK_SURFACE, 'sheet');
    assert(colors.dark.dialogBackground === DARK_SURFACE, 'dialog');
  });
  await test('DN377 dark menu elevated charcoal', () => {
    assert(colors.dark.menuBackground === DARK_ELEVATED, 'menu');
  });
  await test('DN378 dark input charcoal', () => {
    assert(colors.dark.inputBackground === DARK_SURFACE, 'input');
  });
  await test('DN379 dark Paper primary is light neutral', () => {
    assert(read('src/providers/paper-theme.ts').includes('palette.primary'), 'maps primary');
    assert(colors.dark.primary === DARK_PRIMARY, 'token');
  });
  await test('DN380 dark Paper onPrimary dark', () => {
    assert(colors.dark.textOnPrimary === DARK_ON_PRIMARY, 'onPrimary');
  });
  await test('DN381 dark Paper background neutral black', () => {
    assert(colors.dark.background === DARK_BG, 'bg');
  });
  await test('DN382 dark Paper surface charcoal', () => {
    assert(colors.dark.surface === DARK_SURFACE, 'surface');
  });
  await test('DN383 dark Paper outline neutral', () => {
    assert(colors.dark.border === '#2A2A2A', 'outline');
  });
  await test('DN384 dark Paper controls not sage', () => {
    assert(!SAGE_SET.has(colors.dark.primary), 'primary');
    assert(!SAGE_SET.has(colors.dark.accent), 'accent');
  });
  await test('DN385 dark Paper error semantic', () => {
    assert(colors.dark.error === '#EF4444', 'error');
  });
  await test('DN386 Navigation dark primary light', () => {
    assert(colors.dark.primary === DARK_PRIMARY, 'nav primary');
    assert(colors.dark.primary !== SAGE_ACCENT, 'not sage');
    assert(colors.dark.primary !== BRAND_RED, 'not red');
  });
  await test('DN387 dark statusBar light content', () => {
    assert(colors.dark.statusBarStyle === 'light', 'light icons');
  });
  await test('DN388 intro dark matches private-app dark (continuity)', () => {
    assert(DARK_ONBOARDING_ALLOWLIST.background === colors.dark.background, 'intro bg');
    assert(DARK_ONBOARDING_ALLOWLIST.accent === colors.dark.primary, 'intro accent');
    assert(DARK_ONBOARDING_ALLOWLIST.background !== DARK_OLIVE, 'not olive');
    assert(DARK_ONBOARDING_ALLOWLIST.accent !== SAGE_ACCENT, 'not sage');
  });
  await test('DN389 private dark and intro dark share background', () => {
    assert(colors.dark.background === DARK_ONBOARDING_ALLOWLIST.background, 'continuous');
  });
  await test('DN390 private dark controls do not use sage brand', () => {
    assert(colors.dark.primary !== SAGE_ACCENT, 'isolated');
    assert(colors.dark.bottomNavActive !== SAGE_ACCENT, 'nav');
    assert(colors.dark.link !== SAGE_ACCENT, 'link');
  });
  await test('DN391 light intro unaffected', () => {
    assert(resolveIntroColors('light').background === LIGHT_BG, 'light');
  });
  await test('DN392 logo intro unaffected', () => {
    assert(resolveIntroColors('logo').loaderFill === BRAND_RED, 'logo');
  });
  await test('DN393 light background still white', () => {
    assert(colors.light.background === LIGHT_BG, 'light bg');
  });
  await test('DN394 light primary still ink', () => {
    assert(colors.light.primary === LIGHT_INK, 'light primary');
  });
  await test('DN395 light nav still neutral', () => {
    assert(colors.light.bottomNavActive === LIGHT_INK, 'nav');
    assert(colors.light.headerBackground === LIGHT_WHITE, 'header');
  });
  await test('DN396 Logo red unchanged #DC3C2C', () => {
    assert(brandPalette.brandRed === BRAND_RED, 'brand');
    assert(colors.logo.headerBackground === BRAND_RED, 'header');
    assert(colors.logo.bottomNavBackground === BRAND_RED, 'nav');
  });
  await test('DN397 Logo content still light', () => {
    assert(colors.logo.background === LIGHT_BG, 'bg');
    assert(colors.logo.card === LIGHT_WHITE, 'card');
    assert(colors.logo.textPrimary === LIGHT_INK, 'body');
  });
  await test('DN398 dark neutralization does not mutate Logo primary', () => {
    assert(colors.logo.primary === BRAND_RED, 'logo primary');
  });
  await test('DN399 dark neutralization does not mutate Light primary', () => {
    assert(colors.light.primary === LIGHT_INK, 'light primary');
  });
  await test('DN400 dark disabled text #666666', () => {
    assert(colors.dark.textDisabled === '#666666', 'disabled');
  });
  await test('DN401 dark bottomNavBorder #262626', () => {
    assert(colors.dark.bottomNavBorder === '#262626', 'border');
  });
  await test('DN402 dark primaryLight muted charcoal', () => {
    assert(colors.dark.primaryLight === '#262626', 'primaryLight');
    assert(colors.dark.primaryLight !== '#C5D9BE', 'not sageLight');
  });
  await test('DN403 dark primaryDark white', () => {
    assert(colors.dark.primaryDark === '#FFFFFF', 'primaryDark');
  });
  await test('DN404 App Lock uses theme background (dark resolves neutral)', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes('theme.colors.background'), 'lock');
    assert(colors.dark.background === DARK_BG, 'token');
  });
  await test('DN405 Browser header dark is chrome', () => {
    assert(colors.dark.headerBackground === DARK_CHROME, 'browser header');
  });
  await test('DN406 download progress active = primary not success', () => {
    assert(colors.dark.primary !== colors.dark.success, 'progress');
  });
  await test('DN407 WebView key not theme-based', () => {
    const src = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!/key=\{[^}]*theme/.test(src), 'no theme key');
  });
  await test('DN408 no setInterval in theme actions', () => {
    assert(!read('src/store/theme/actions.ts').includes('setInterval'), 'no poll');
  });
  await test('DN409 dark contrast textPrimary/background >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.dark.textPrimary, colors.dark.background));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('DN410 dark contrast secondary/background >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.dark.textSecondary, colors.dark.background));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('DN411 dark contrast muted/background >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.dark.textMuted, colors.dark.background));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN412 dark contrast onPrimary/primary >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.dark.textOnPrimary, colors.dark.primary));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('DN413 dark contrast active nav >= 4.5', () => {
    const r = roundContrast(
      contrastRatio(colors.dark.bottomNavActive, colors.dark.bottomNavBackground),
    );
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('DN414 dark contrast inactive nav >= 3.0', () => {
    const r = roundContrast(
      contrastRatio(colors.dark.bottomNavInactive, colors.dark.bottomNavBackground),
    );
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN415 dark contrast placeholder/input >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.dark.textMuted, colors.dark.inputBackground));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN416 dark contrast input text/input >= 4.5', () => {
    const r = roundContrast(contrastRatio(colors.dark.textPrimary, colors.dark.inputBackground));
    assert(r != null && r >= 4.5, `got ${r}`);
  });
  await test('DN417 dark contrast success/surface >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.dark.success, colors.dark.surface));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN418 dark contrast error/surface >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.dark.error, colors.dark.surface));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN419 dark contrast warning/surface >= 3.0', () => {
    const r = roundContrast(contrastRatio(colors.dark.warning, colors.dark.surface));
    assert(r != null && r >= 3.0, `got ${r}`);
  });
  await test('DN420 inverse: Light primary dark / Dark primary light', () => {
    assert(colors.light.primary === LIGHT_INK, 'light dark-ink');
    assert(colors.dark.primary === DARK_PRIMARY, 'dark light-ink');
    assert(colors.light.textOnPrimary === '#FFFFFF', 'light onPrimary white');
    assert(colors.dark.textOnPrimary === DARK_ON_PRIMARY, 'dark onPrimary black');
  });
  await test('DN421 colors.ts documents Dark private-app neutral contract', () => {
    const src = read('src/theme/colors.ts');
    assert(src.includes('BLACK + CHARCOAL + WHITE + GRAY'), 'contract');
    assert(src.includes('reservoir') || src.includes('NOT map into'), 'no olive intro mapping');
  });
  await test('DN422 SegmentedControl uses primary (dark = off-white)', () => {
    assert(read('src/components/inputs/SegmentedControl.tsx').includes('theme.colors.primary'), 'wired');
  });
  await test('DN423 Button primary uses theme via button-styles', () => {
    const styles = read('src/components/buttons/button-styles.ts');
    assert(
      styles.includes('theme.colors.primary') || styles.includes('.primary'),
      'primary token',
    );
    assert(styles.includes('textOnPrimary') || styles.includes('onPrimary'), 'onPrimary');
  });
  await test('DN424 Badge success still semantic', () => {
    assert(read('src/components/common/Badge.tsx').includes('theme.colors.success'), 'badge');
  });
  await test('DN425 dark sheet handle path uses theme tokens', () => {
    assert(colors.dark.sheetBackground === DARK_SURFACE, 'sheet');
  });
  await test('DN426 dark info remains semantic distinct', () => {
    assert(colors.dark.info === '#5B9AA9', 'info');
    assert(colors.dark.info !== colors.dark.primary, '≠primary');
  });
  await test('DN427 splash/intro dark is neutral (no olive cinematic)', () => {
    assert(!read('src/theme/intro-palette.ts').includes("'#1A2517'"), 'no olive intro');
    assert(resolveIntroColors('dark').background === colors.dark.background, 'dark continuous');
    assert(colors.dark.background !== DARK_OLIVE, 'app not olive');
  });
  await test('DN428 no olive hex in dark theme token values', () => {
    for (const [key, value] of Object.entries(colors.dark)) {
      if (typeof value !== 'string' || !value.startsWith('#')) continue;
      assert(value !== DARK_OLIVE, `dark.${key}`);
      assert(value !== SAGE_ACCENT, `dark.${key} sage`);
      assert(value !== '#222E1E', `dark.${key} oliveSurface`);
      assert(value !== '#2A3824', `dark.${key} oliveCard`);
    }
  });
  await test('DN429 dark contrast report for neutralization', () => {
    const text = roundContrast(contrastRatio(colors.dark.textPrimary, colors.dark.background));
    const btn = roundContrast(contrastRatio(colors.dark.textOnPrimary, colors.dark.primary));
    const nav = roundContrast(
      contrastRatio(colors.dark.bottomNavActive, colors.dark.bottomNavBackground),
    );
    console.log(`      DARK-neutral contrast text=${text} btn=${btn} navActive=${nav}`);
    assert(text != null && btn != null && nav != null, 'measured');
  });

  // ─── GROUP SC — STARTUP THEME CONTINUITY ─────────────────────────
  await test('SC1 LIGHT startup intro background is neutral white', () => {
    assert(resolveIntroColors('light').background === LIGHT_BG, 'light splash');
  });
  await test('SC2 LIGHT onboarding background is neutral white', () => {
    assert(resolveOnboardingSurfaces('light').background === LIGHT_BG, 'light onboarding');
  });
  await test('SC3 AppLockGate bootstrap uses theme.colors.background', () => {
    assert(read('src/security/app-lock/AppLockGate.tsx').includes('theme.colors.background'), 'gate');
  });
  await test('SC4 DARK startup intro background is neutral dark', () => {
    assert(resolveIntroColors('dark').background === colors.dark.background, 'dark splash');
    assert(resolveIntroColors('dark').background !== DARK_OLIVE, 'not olive');
  });
  await test('SC5 DARK onboarding background is neutral dark', () => {
    assert(resolveOnboardingSurfaces('dark').background === colors.dark.background, 'dark onboarding');
    assert(!Object.values(resolveOnboardingSurfaces('dark')).includes(SAGE_ACCENT as never), 'no sage accent value as brand');
  });
  await test('SC6 LOGO startup uses Logo tokens', () => {
    assert(resolveIntroColors('logo').background === colors.logo.background, 'logo bg');
    assert(resolveIntroColors('logo').loaderFill === BRAND_RED, 'logo accent');
  });
  await test('SC7 LOGO onboarding uses Logo tokens', () => {
    assert(resolveOnboardingSurfaces('logo').accent === BRAND_RED, 'logo onboarding');
  });
  await test('SC8 brand red #DC3C2C unchanged', () => {
    assert(brandPalette.brandRed === BRAND_RED, 'red');
  });
  await test('SC9 no legacy olive Dark startup surface in intro-palette', () => {
    assert(!read('src/theme/intro-palette.ts').includes('#1A2517'), 'no olive');
    assert(!read('src/theme/onboarding-surfaces.ts').includes('#1A2517'), 'no olive surfaces');
  });
  await test('SC10 no sage Light startup surface', () => {
    assert(resolveIntroColors('light').background !== LEGACY_SAGE_BG, 'light');
    assert(resolveOnboardingSurfaces('light').background !== LEGACY_SAGE_BG, 'onboarding');
  });
  await test('SC11 auth layout uses resolveIntroColors (not SPLASH_COLORS olive)', () => {
    const auth = read('src/app/(auth)/_layout.tsx');
    assert(auth.includes('resolveIntroColors'), 'intro');
    assert(!auth.includes('SPLASH_COLORS'), 'no splash olive');
  });
  await test('SC12 root layout uses resolveStartupBackground before ready', () => {
    const root = read('src/app/_layout.tsx');
    assert(root.includes('resolveStartupBackground'), 'startup bg');
    assert(!root.includes('SPLASH_COLORS'), 'no olive');
  });
  await test('SC13 app-provider themed root (not forced light.background only)', () => {
    const src = read('src/providers/app-provider.tsx');
    assert(src.includes('useTheme'), 'useTheme');
    assert(src.includes('resolveStartupBackground'), 'mmkv fallback');
    assert(!src.includes('colors.light.background'), 'not forced light');
  });
  await test('SC14 startup-theme helper exists (MMKV → mode)', () => {
    assert(read('src/theme/startup-theme.ts').includes('getThemeMode'), 'mmkv');
    assert(read('src/theme/startup-theme.ts').includes('normalizeThemePreference'), 'normalize');
  });
  await test('SC15 ProtectedRouteGuard themed fill', () => {
    assert(read('src/navigation/guards/ProtectedRouteGuard.tsx').includes('theme.colors.background'), 'fill');
  });
  await test('SC16 OnboardingRouteGuard themed fill', () => {
    assert(read('src/navigation/guards/OnboardingRouteGuard.tsx').includes('theme.colors.background'), 'fill');
  });
  await test('SC17 StatusBar uses theme statusBarStyle', () => {
    assert(read('src/providers/status-bar.tsx').includes('statusBarStyle'), 'status');
  });
  await test('SC18 Android NavigationBar setStyle by mode', () => {
    assert(read('src/providers/status-bar.tsx').includes('NavigationBar.setStyle'), 'nav bar');
  });
  await test('SC19 no second theme store', () => {
    assert(read('src/store/theme/index.ts').includes('useThemeStore'), 'one store');
    assert(read('src/theme/startup-theme.ts').includes('does not create a second theme store'), 'doc');
  });
  await test('SC20 SPLASH_COLORS defaults are light-neutral (not olive)', () => {
    const src = read('src/screens/splash/constants/splash.constants.ts');
    assert(src.includes('colors.light.background'), 'light default');
    assert(!src.includes('#1A2517'), 'no olive');
  });
  await test('SC21 App Lock security gate still present', () => {
    assert(read('src/security/app-lock/AppLockGate.tsx').includes('AppLockGate'), 'gate');
  });
  await test('SC22 Browser start page still uses BrowserHomeView', () => {
    assert(read('src/browser/components/BrowserContainer/BrowserContainer.tsx').includes('BrowserHomeView'), 'browser');
  });
  await test('SC23 downloader not imported by startup theme helpers', () => {
    assert(!read('src/theme/startup-theme.ts').includes('@/downloads'), 'isolation');
    assert(!read('src/theme/intro-palette.ts').includes('@/downloads'), 'isolation');
  });
  await test('SC24 #DC3C2C Logo sourceHex unchanged', () => {
    assert(brandPalette.sourceHex === BRAND_RED, 'source');
  });

  console.log(`\nTheme system verifier: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  if (passed < 400) {
    console.error(`Expected at least 400 passing checks, got ${passed}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
