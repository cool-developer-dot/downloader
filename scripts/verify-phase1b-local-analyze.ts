/**
 * Phase 1B — local analyze + core path no longer requires VidoraX API.
 * Run: npx tsx scripts/verify-phase1b-local-analyze.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log('Phase 1B local analyze / core-local verification\n');

test('local analyzer module exists with contract exports', () => {
  const index = read('src/downloads/analyze/index.ts');
  assert(index.includes('analyzeMediaUrl'), 'exports analyzeMediaUrl');
  assert(index.includes('LOCAL_ANALYZE'), 'exports LOCAL_ANALYZE');
  assert(
    index.includes('LocalAnalyzeNetworkError'),
    'exports LocalAnalyzeNetworkError',
  );

  const analyze = read('src/downloads/analyze/analyze-url.ts');
  assert(analyze.includes('export async function analyzeMediaUrl'), 'analyzeMediaUrl');
  assert(analyze.includes('MediaAnalysisResult'), 'returns MediaAnalysisResult shape');
  assert(analyze.includes('fetchAndParseHlsPlaylist'), 'reuses engine HLS fetch/parse');
  assert(
    !/post\s*\(\s*['"`]\/downloads\/analyze|api\.post\(['"`]\/downloads\/analyze|analyzeDownload\(/.test(
      analyze,
    ),
    'no backend analyze call',
  );
});

test('analyzer enforces client safety bounds', () => {
  const constants = read('src/downloads/analyze/constants.ts');
  assert(constants.includes('timeoutMs'), 'timeout');
  assert(constants.includes('maxManifestBytes'), 'manifest size cap');
  assert(constants.includes('maxHlsVariants'), 'variant cap');

  const probe = read('src/downloads/analyze/probe.ts');
  assert(probe.includes('isSafeHttpUrl'), 'URL safety');
  assert(probe.includes('redirect: \'follow\'') || probe.includes('redirect: "follow"'), 'redirect follow');
  assert(probe.includes('maxBytes'), 'bounded text fetch');
  assert(probe.includes('mergeSignals'), 'timeout + cancel');
});

test('unsupported classifications mapped from engine errors', () => {
  const format = read('src/downloads/analyze/format.ts');
  assert(format.includes("case 'UNSUPPORTED_DRM'"), 'DRM');
  assert(format.includes("case 'UNSUPPORTED_HLS_ENCRYPTION'"), 'encrypted HLS');
  assert(format.includes("case 'LIVE_HLS_UNSUPPORTED'"), 'live HLS');
  assert(format.includes("return 'DRM_PROTECTED'"), 'DRM reason');
  assert(format.includes("return 'ENCRYPTED_MEDIA'"), 'encrypted reason');
  assert(format.includes("return 'UNSUPPORTED_STREAM'"), 'stream reason');
});

test('quality selection uses local analyzeMediaUrl (not API)', () => {
  const hook = read('src/screens/downloads/quality/useQualitySelection.ts');
  assert(hook.includes("from '@/downloads/analyze'"), 'imports local analyzer');
  assert(hook.includes('analyzeMediaUrl'), 'calls analyzeMediaUrl');
  assert(!hook.includes('analyzeDownload'), 'no analyzeDownload API call');
  assert(!hook.includes("from '@/api'"), 'no api barrel for analyze');
  assert(
    !hook.includes('errors.unauthorized') && !hook.includes('isUnauthorized'),
    'local analyze must not map Unauthorized',
  );
});

test('Home / Downloads / Browser still use useQualitySelection', () => {
  const home = read('src/screens/home/HomeScreen.tsx');
  const downloads = read('src/screens/downloads/DownloadsScreen.tsx');
  const browser = read('src/browser/BrowserScreen.tsx');
  assert(home.includes('useQualitySelection'), 'Home paste-link');
  assert(downloads.includes('useQualitySelection'), 'Downloads paste-link');
  assert(browser.includes('useQualitySelection'), 'Browser download CTA');
  assert(browser.includes('openWithUrl'), 'Browser opens quality flow');
});

test('Phase 1A core create/list remain local (no mandatory API)', () => {
  const actions = read('src/store/downloads/actions.ts');
  assert(actions.includes('createId()'), 'local create id');
  assert(!/await createDownload\(/.test(actions), 'no mandatory POST /downloads');
  assert(!/await listDownloads\(/.test(actions), 'no mandatory GET /downloads');
  assert(actions.includes('downloadCatalogRepository'), 'catalog authority');

  const library = read('src/screens/library/hooks/useLibraryScreen.ts');
  assert(!library.includes('fetchAllMediaLibraryPages'), 'no library remote require');
});

test('analyze API module is removed; quality UI stays local', () => {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  assert(
    !existsSync(resolve(root, 'src/api/downloads.api.ts')),
    'downloads.api.ts removed',
  );
  const hook = read('src/screens/downloads/quality/useQualitySelection.ts');
  assert(!hook.includes('analyzeDownload'), 'quality UI disconnected');
  assert(hook.includes('analyzeMediaUrl'), 'uses local analyzer');
});

test('browser chrome CTA passes Referer; no document.cookie harvest', () => {
  // Production CTA is BrowserMediaDownloadBar (Phase 2E/F); overlay is no longer mounted.
  const bar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
  assert(bar.includes('referer'), 'passes referer option');
  const screen = read('src/browser/BrowserScreen.tsx');
  assert(screen.includes('BrowserMediaDownloadBar'), 'BrowserScreen mounts media CTA');
  assert(!screen.includes('MediaDiscoveryOverlay'), 'overlay not mounted on BrowserScreen');
  assert(!/document\.cookie/.test(screen), 'no document.cookie harvest in BrowserScreen');
  const probe = read('src/downloads/analyze/probe.ts');
  assert(probe.includes('Referer'), 'sets Referer header when safe');
  // Cookie may be attached from existing MediaRequestContext for social CDN
  // (Phase 1 social-transfer) — never scraped from the WebView document in chrome.
  assert(!/document\.cookie/.test(probe), 'probe does not scrape document.cookie');
});

console.log('\nAll Phase 1B checks passed.');
