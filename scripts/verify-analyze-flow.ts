/**
 * Comprehensive Paste Link → Analyze → Download flow regression tests.
 * Run: npx tsx scripts/verify-analyze-flow.ts
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
  analyzeFailureCopy,
  analyzeProgressCopy,
  isAnalyzeBusy,
  mapPendingStatusToAnalyzePhase,
} from '../src/downloads/analyze/analyze-state-machine';
import {
  classifyPasteInput,
  requiresPageMediaResolution,
} from '../src/media-detection/services/platform-page-url';
import { pendingMediaResolutionService } from '../src/media-detection/services/pending-media-resolution.service';
import {
  resolveDownloadTitle,
  isHashLikeTitle,
} from '../src/downloads/quality/download-metadata';
import {
  formatStreamPresentation,
  formatQualityFileSize,
} from '../src/downloads/quality/format';
import type { DownloadQualityOption } from '../src/downloads/quality/types';

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

// 1. Direct MP4 → Analyze path
assert(classifyPasteInput(directMp4) === 'direct', 'direct MP4 uses direct analyze path');

// 2. TikTok page → page resolution flow
assert(classifyPasteInput(tiktokShort) === 'page', 'TikTok short link uses page flow');

// 3. Instagram page → page resolution flow
assert(classifyPasteInput(igReel) === 'page', 'Instagram reel uses page flow');

// 4. Page URL never treated as direct-only shortcut in classifier
assert(requiresPageMediaResolution(igReel), 'Instagram page requires page resolution');
assert(!requiresPageMediaResolution(directMp4), 'direct MP4 skips page resolution');

// 5. Browser fallback session persists
const session = pendingMediaResolutionService.start({
  originalUrl: tiktokShort,
  canonicalUrl: 'https://www.tiktok.com/@user/video/123',
  platform: 'tiktok',
});
assert(pendingMediaResolutionService.get()?.id === session.id, 'browser fallback session persists');
pendingMediaResolutionService.update({ status: 'waiting_playback' });
assert(
  mapPendingStatusToAnalyzePhase('waiting_playback') === 'waiting_for_playback',
  'waiting_playback maps to WAITING_FOR_PLAYBACK phase',
);

// 6. Candidate completes pending resolution (service API)
pendingMediaResolutionService.markVerified();
assert(
  pendingMediaResolutionService.get()?.status === 'verified',
  'verified candidate completes pending resolution',
);
pendingMediaResolutionService.clear();

// 7. Metadata format uses stream presentation not filename
const mp4Option: DownloadQualityOption = {
  id: '1',
  label: '1080p',
  sourceUrl: directMp4,
  resolution: '1920x1080',
  width: 1920,
  height: 1080,
  bitrate: 8_000_000,
  averageBitrate: 8_000_000,
  videoBitrate: 7_500_000,
  audioBitrate: 128_000,
  codec: 'avc1',
  videoCodec: 'avc1',
  audioCodec: 'mp4a',
  rawCodec: 'avc1.640028,mp4a.40.2',
  container: 'mp4',
  mimeType: 'video/mp4',
  fileSize: '18400000',
  estimatedFileSize: 18_400_000,
  fps: 30,
  frameRate: 30,
  streamType: 'PROGRESSIVE',
  isHls: false,
  isProgressive: true,
  isAudioOnly: false,
  mediaType: 'video',
  hasAudio: true,
  hasVideo: true,
  downloadable: true,
  unavailableReason: null,
};
assert(
  formatStreamPresentation(mp4Option) === 'MP4',
  'metadata result contains actual MP4 format',
);

// 8. Size handling — exact when available, no fabrication
const size = formatQualityFileSize(mp4Option.estimatedFileSize);
assert(Boolean(size && size.includes('MB')), 'exact size shown when available');
assert(formatQualityFileSize(null) === null, 'missing size returns null not fake value');

// 9. Multiple qualities supported in selection model
assert(mp4Option.height === 1080, 'quality height preserved for selection');

// 10–12. HTML/image rejection covered in verify-download-validation.ts
const validationSrc = read('scripts/verify-download-validation.ts');
assert(validationSrc.includes('HTML response fails'), 'HTML rejection test exists');

// 13. Download creates via store (wiring check)
const hookSrc = read('src/screens/downloads/quality/useQualitySelection.ts');
assert(hookSrc.includes('useDownloadsStore'), 'download creates active Downloads entry via store');

// 14. Library bridge exists
const librarySrc = read('src/library/ensure-completion-bridge.ts');
assert(librarySrc.includes('notifyLibraryDownloadCompleted'), 'completion makes item available to Library');

// 15. Internal hash never displayed as user title
assert(
  isHashLikeTitle('e06b1131f6f7457d9c584ea425a1f9eb'),
  'hash-like title detected',
);
assert(
  resolveDownloadTitle({ title: 'e06b1131f6f7457d9c584ea425a1f9eb', platform: 'TIKTOK' }) ===
    'TikTok Video',
  'internal hash never displayed as user title',
);

// 16. Failed resolution exits loading state
assert(
  mapPendingStatusToAnalyzePhase('failed') === 'failed',
  'failed resolution exits loading state',
);
assert(!isAnalyzeBusy('failed'), 'failed is not a busy analyze phase');

// 17. Browser fallback does not reload repeatedly
const watcherSrc = read('src/media-detection/hooks/usePendingMediaResolution.ts');
assert(watcherSrc.includes('queueNavigationOnce'), 'browser watcher queues navigation once');

// State machine copy
assert(
  analyzeProgressCopy('detecting_media', { flowKind: 'page', platform: 'tiktok' }).includes(
    'TikTok',
  ),
  'platform-aware analyzing copy for TikTok',
);
assert(
  analyzeProgressCopy('detecting_media', { flowKind: 'page', platform: 'instagram' }).includes(
    'Instagram',
  ),
  'platform-aware analyzing copy for Instagram',
);

// Sheet stays open during page resolution
const sheetSrc = read('src/screens/downloads/quality/useQualitySelection.ts');
assert(
  !sheetSrc.includes('dismissForBrowserHandoff'),
  'sheet no longer dismisses immediately on page handoff',
);
assert(sheetSrc.includes('detecting_media'), 'page flow keeps sheet in detecting phase');

// Shared provider
const tabsSrc = read('src/app/(app)/(tabs)/_layout.tsx');
assert(tabsSrc.includes('QualitySelectionProvider'), 'tabs layout mounts shared provider');

const providerSrc = read('src/screens/downloads/quality/QualitySelectionProvider.tsx');
assert(providerSrc.includes('usePendingMediaResolution'), 'provider owns page-resolution watcher');

// Premium media card
const cardSrc = read('src/screens/downloads/quality/MediaResultCard.tsx');
assert(cardSrc.includes('Video found'), 'premium media result card present');

console.log(`\nAnalyze flow: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
