/**
 * Page-resolution state-machine regression tests.
 * Run: npx tsx scripts/verify-page-resolution-flow.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  classifyPasteInput,
  requiresPageMediaResolution,
} from '../src/media-detection/services/platform-page-url';
import { pendingMediaResolutionService } from '../src/media-detection/services/pending-media-resolution.service';
import { isSameDocumentUrl } from '../src/media-detection/utils';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const tiktokShort = 'https://vt.tiktok.com/ZSVtTrHh5/';
const igReel =
  'https://www.instagram.com/reel/DcmMB5FAKt6/?igsi=eHllbXF4azBpa29u';
const directMp4 = 'https://cdn.example.com/video.mp4';

assert(classifyPasteInput(tiktokShort) === 'page', 'TikTok short link is page flow');
assert(classifyPasteInput(igReel) === 'page', 'Instagram reel is page flow');
assert(classifyPasteInput(directMp4) === 'direct', 'direct MP4 skips page flow');
assert(!requiresPageMediaResolution(directMp4), 'direct MP4 skips page resolution');

const session = pendingMediaResolutionService.start({
  originalUrl: tiktokShort,
  canonicalUrl: 'https://www.tiktok.com/@user/video/123',
  platform: 'tiktok',
});
assert(session.platform === 'tiktok', 'pending session created for TikTok');
assert(session.id.startsWith('pmr_'), 'session id stable format');

const sameSession = pendingMediaResolutionService.get();
assert(sameSession?.id === session.id, 'session survives service reads');

pendingMediaResolutionService.update({ status: 'waiting_media' });
assert(
  pendingMediaResolutionService.get()?.status === 'waiting_media',
  'session enters waiting_media',
);

assert(
  pendingMediaResolutionService.matchesPageUrl(
    'https://www.tiktok.com/@user/video/123',
  ),
  'browser URL matches canonical session',
);

assert(
  isSameDocumentUrl('https://www.instagram.com/reel/DcmMB5FAKt6/', igReel),
  'Instagram tracking query matches session page',
);

pendingMediaResolutionService.clear();
assert(pendingMediaResolutionService.get() === null, 'session clears after completion');

const qualitySrc = read('src/screens/downloads/quality/useQualitySelection.ts');
assert(
  !qualitySrc.includes('dismissForBrowserHandoff'),
  'quality selection keeps sheet open during page resolution',
);
assert(
  qualitySrc.includes("pendingMediaResolutionService.update({ status: 'waiting_media' })") &&
    qualitySrc.includes('detecting_media'),
  'handoff updates session and keeps sheet in detecting phase',
);

const navSrc = read('src/browser/services/pending-navigation.service.ts');
assert(navSrc.includes('consume('), 'pending navigation exposes consume API');
assert(navSrc.includes('targetTabId'), 'pending navigation binds targetTabId');

const browserSrc = read('src/browser/BrowserScreen.tsx');
assert(
  browserSrc.includes('pendingNavigationService.consume('),
  'Browser consumes pending navigation once on focus',
);
assert(
  browserSrc.includes('tabControllerRegistry.get(pending.targetTabId)') ||
    browserSrc.includes('tabControllerRegistry.get(consumed.targetTabId)'),
  'Browser waits for target tab controller, not any active controller',
);

const watcherSrc = read('src/media-detection/hooks/usePendingMediaResolution.ts');
assert(
  !watcherSrc.includes('navigationQueuedRef'),
  'removed navigationQueuedRef guard that could block first navigation',
);
assert(
  watcherSrc.includes('queueNavigationOnce'),
  'browser watcher queues navigation once when needed',
);

console.log(`\nPage resolution flow: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
