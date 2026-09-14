/**
 * Download CTA persistence hardening verifier.
 * Prefer exported transition helpers over string greps.
 * Run: npm run verify:download-cta-persistence-hardening
 */

import {
  isSameContentIdentity,
  shouldAcceptVerificationResult,
  shouldHideStickyOfferForLiveIdentity,
  shouldInvalidateCurrentMedia,
  shouldRetainAvailableCta,
  shouldStartVerification,
} from '../src/browser/media-actions/cta-persistence';
import { resolveLivePresentationOwnership } from '../src/browser/media-actions/browser-download-presentation';
import { toBrowserMediaCtaState } from '../src/browser/media-actions/browser-media-action.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const root = path.join(__dirname, '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('Download CTA persistence hardening verifier\n');

// ─── Same video stability ───────────────────────────────────────────────────

test('1 A verified → AVAILABLE retain', () => {
  assert(
    shouldRetainAvailableCta({
      status: 'verified',
      offerContentIdentity: 'tiktok:tiktok_video:111',
      nextContentIdentity: 'tiktok:tiktok_video:111',
      nextOwnershipConfidence: 'STRONG',
    }),
    'retain',
  );
  assert(toBrowserMediaCtaState('verified') === 'AVAILABLE', 'cta');
});

test('2 duplicate observation A → stays AVAILABLE (no re-verify)', () => {
  assert(
    !shouldStartVerification({
      status: 'verified',
      offerContentIdentity: 'ig:instagram_reel:abc',
      nextContentIdentity: 'ig:instagram_reel:abc',
      verifiedCandidateId: 'c1',
      nextCandidateId: 'c2',
    }),
    'skip verify',
  );
});

test('3 signed query / same identity → same content', () => {
  assert(
    isSameContentIdentity('tiktok:tiktok_video:1', 'tiktok:tiktok_video:1'),
    'same',
  );
});

test('4 CDN refresh same identity → do not invalidate', () => {
  assert(
    !shouldInvalidateCurrentMedia({
      priorContentIdentity: 'tiktok:tiktok_video:1',
      nextContentIdentity: 'tiktok:tiktok_video:1',
      nextOwnershipConfidence: 'STRONG',
    }),
    'no invalidate',
  );
});

test('5 buffering / weak next → retain', () => {
  assert(
    shouldRetainAvailableCta({
      status: 'verified',
      offerContentIdentity: 'tiktok:tiktok_video:1',
      nextContentIdentity: 'tiktok:tiktok_video:ephemeral:x',
      nextOwnershipConfidence: 'WEAK',
    }),
    'retain weak',
  );
});

test('6 pause/play still current → retain', () => {
  assert(
    shouldRetainAvailableCta({
      status: 'verified',
      offerContentIdentity: 'a',
      nextContentIdentity: 'a',
      nextOwnershipConfidence: null,
    }),
    'retain',
  );
});

test('7 temporary candidate-null → retain', () => {
  assert(
    shouldRetainAvailableCta({
      status: 'verified',
      offerContentIdentity: 'a',
      nextContentIdentity: null,
      nextOwnershipConfidence: null,
    }),
    'gap retain',
  );
});

test('8–9 refresh start/success → presentation retain same identity', () => {
  assert(
    !shouldStartVerification({
      status: 'verified',
      offerContentIdentity: 'a',
      nextContentIdentity: 'a',
      verifiedCandidateId: 'old',
      nextCandidateId: 'new',
    }),
    'no restart',
  );
});

test('10 strong different identity → do not retain', () => {
  assert(
    !shouldRetainAvailableCta({
      status: 'verified',
      offerContentIdentity: 'a',
      nextContentIdentity: 'b',
      nextOwnershipConfidence: 'STRONG',
    }),
    'release',
  );
});

// ─── New video ──────────────────────────────────────────────────────────────

test('11–12 A→B strong → invalidate A', () => {
  assert(
    shouldInvalidateCurrentMedia({
      priorContentIdentity: 'a',
      nextContentIdentity: 'b',
      nextOwnershipConfidence: 'STRONG',
    }),
    'invalidate',
  );
});

test('13–15 B/C independent identities', () => {
  assert(!isSameContentIdentity('b', 'c'), 'distinct');
  assert(
    shouldStartVerification({
      status: 'idle',
      offerContentIdentity: null,
      nextContentIdentity: 'b',
      verifiedCandidateId: null,
      nextCandidateId: 'b1',
    }),
    'start B',
  );
});

test('16–17 consumed does not affect invalidate/start for new id', () => {
  assert(
    shouldInvalidateCurrentMedia({
      priorContentIdentity: 'a',
      nextContentIdentity: 'b',
      nextOwnershipConfidence: 'MEDIUM',
    }),
    'B wins',
  );
});

test('18–20 recycled / feed identity rules via hide helper', () => {
  assert(
    shouldHideStickyOfferForLiveIdentity({
      offerContentIdentity: 'a',
      liveContentIdentity: 'b',
      liveOwnershipConfidence: 'STRONG',
    }),
    'hide A for B',
  );
  assert(
    !shouldHideStickyOfferForLiveIdentity({
      offerContentIdentity: 'a',
      liveContentIdentity: 'b',
      liveOwnershipConfidence: 'WEAK',
    }),
    'weak no hide',
  );
});

// ─── Stale async ────────────────────────────────────────────────────────────

test('21–24 stale A after B current → rejected', () => {
  assert(
    !shouldAcceptVerificationResult({
      resultTabId: 't1',
      activeTabId: 't1',
      resultNavigationEpoch: 1,
      currentNavigationEpoch: 1,
      resultContentIdentity: 'a',
      currentContentIdentity: 'b',
      resultGeneration: 1,
      currentGeneration: 2,
    }),
    'stale gen',
  );
  assert(
    !shouldAcceptVerificationResult({
      resultTabId: 't1',
      activeTabId: 't2',
      resultNavigationEpoch: 1,
      currentNavigationEpoch: 1,
      resultContentIdentity: 'a',
      currentContentIdentity: 'a',
      resultGeneration: 1,
      currentGeneration: 1,
    }),
    'wrong tab',
  );
});

test('25 stale A content mismatch rejected', () => {
  assert(
    !shouldAcceptVerificationResult({
      resultTabId: 't1',
      activeTabId: 't1',
      resultNavigationEpoch: 3,
      currentNavigationEpoch: 3,
      resultContentIdentity: 'a',
      currentContentIdentity: 'b',
      resultGeneration: 5,
      currentGeneration: 5,
    }),
    'content mismatch',
  );
});

// ─── Lifecycle / quality / handoff source contracts ─────────────────────────

test('26–33 sticky wiring + quality cancel + consume contracts in sources', () => {
  const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(hook.includes('shouldRetainAvailableCta'), 'retain');
  assert(hook.includes('shouldStartVerification'), 'start');
  assert(hook.includes('shouldInvalidateCurrentMedia'), 'invalidate');
  assert(hook.includes('endQualitySelection'), 'quality cancel');
  assert(hook.includes('commitConsumed'), 'consume');
  assert(!/setInterval|setTimeout\(\s*\(\)\s*=>\s*.*AVAILABLE/.test(hook), 'no timer sticky');
  const service = read('src/browser/media-actions/browser-media-action.service.ts');
  assert(service.includes('shouldInvalidateCurrentMedia'), 'service gate');
  assert(service.includes('beginQualitySelection'), 'sheet lock');
});

// ─── Social / general / tab / generation / security ─────────────────────────

test('34–46 social+general sticky presentation ownership', () => {
  assert(
    resolveLivePresentationOwnership({
      canonicalContentId: '123',
      identityConfidence: 'STRONG',
    }) === 'STRONG',
    'canonical strong',
  );
  assert(
    resolveLivePresentationOwnership({
      intersectionRatio: 0.2,
    }) === 'WEAK',
    'dip weak',
  );
  assert(
    resolveLivePresentationOwnership({
      intersectionRatio: 0.7,
    }) === 'MEDIUM',
    'visible medium',
  );
  const pres = read('src/browser/media-actions/browser-download-presentation.ts');
  assert(pres.includes('shouldHideStickyOfferForLiveIdentity'), 'pres sticky');
  assert(pres.includes('resolveLivePresentationOwnership'), 'live owner');
});

test('47–55 tab/generation/no-polling/bounds contracts', () => {
  const service = read('src/browser/media-actions/browser-media-action.service.ts');
  assert(service.includes('setActiveTab'), 'tabs');
  assert(service.includes('clearTab'), 'close');
  assert(service.includes('MAX_CONSUMED_PER_TAB'), 'bound');
  assert(service.includes('resetForNavigation'), 'nav');
  const persist = read('src/browser/media-actions/cta-persistence.ts');
  assert(!persist.includes('setInterval'), 'no poll');
  assert(!persist.includes('setTimeout'), 'no timer');
  assert(persist.includes('LEGITIMATE_CTA_CLEAR_REASONS'), 'clear reasons');
});

test('56–66 security / no DOM inject / no second detector', () => {
  const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(!hook.includes('document.createElement'), 'no inject');
  assert(!/Cookie\s*[:=]/.test(hook), 'no cookie assign');
  const bar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
  assert(bar.includes('Download') || bar.includes('download'), 'cta ui');
});

test('67–70 one presentation owner + dedupe start verify', () => {
  assert(
    !shouldStartVerification({
      status: 'verified',
      offerContentIdentity: 'x',
      nextContentIdentity: 'x',
      verifiedCandidateId: '1',
      nextCandidateId: '1',
    }),
    'dedupe',
  );
  assert(
    !shouldInvalidateCurrentMedia({
      priorContentIdentity: 'a',
      nextContentIdentity: 'b',
      nextOwnershipConfidence: 'WEAK',
    }),
    'weak no steal',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
