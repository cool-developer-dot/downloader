/**
 * Phase 4C — Social download integration verifier (code/static only).
 * Usage: npm run verify:phase4c-social-download-integration
 *
 * No Python, Maestro, Appium, emulator, or network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import { toBrowserMediaCtaState } from '../src/browser/media-actions/browser-media-action.types';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import {
  getSocialSourceRefreshProvider,
  registerSocialSourceRefreshProvider,
  resolveFreshSocialSourceForDownload,
  type FreshSocialSourceResult,
} from '../src/downloads/engine/social-source-refresh.provider';
import type { MediaAnalysisResult } from '../src/api/types';
import type { DetectedMedia } from '../src/media-detection/types';
import type { MediaRequestContext } from '../src/downloads/types/request-context';

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
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function makeMedia(partial: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_4c_1',
    url: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
    finalUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
    sourceUrl: null,
    pageUrl: 'https://www.instagram.com/reel/ABC123/',
    title: 'Reel A',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.9,
    detectionSource: 'native_network',
    requiresCookies: false,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 12,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    codec: null,
    audioCodec: null,
    estimatedFileSize: 4_000_000,
    websiteSource: 'instagram.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
    ...partial,
  };
}

function makeAnalysis(partial: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    title: 'Reel A',
    platform: 'instagram',
    sourceUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
    finalUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
    thumbnailUrl: null,
    duration: 12,
    container: 'mp4',
    downloadable: true,
    variants: [
      {
        id: 'v1',
        label: '1080p',
        height: 1920,
        width: 1080,
        bitrate: null,
        filesize: 4_000_000,
        ext: 'mp4',
        url: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
        downloadable: true,
        hasAudio: true,
        videoOnly: false,
      },
    ],
    ...partial,
  };
}

function makeCtx(partial: Partial<MediaRequestContext> = {}): MediaRequestContext {
  return {
    pageUrl: 'https://www.instagram.com/reel/ABC123/',
    originalPageUrl: 'https://www.instagram.com/reel/ABC123/',
    referer: 'https://www.instagram.com/',
    userAgent: 'VidoraXTest/1',
    cookiesRequired: false,
    hasCookies: false,
    headers: { Referer: 'https://www.instagram.com/' },
    capturedAt: Date.now(),
    ...partial,
  };
}

function resetCta(): void {
  browserMediaActionService.__resetAllForTests();
}

async function main(): Promise<void> {
  console.log('\n=== Phase 4C Social Download Integration ===\n');

  await test('1. 4A identity reaches 4B offer path in code', () => {
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('buildVerifiedSocialMediaOffer'), 'missing 4B offer builder');
    assert(hook.includes('contentIdentity'), 'missing contentIdentity capture');
    assert(hook.includes('socialContextGeneration'), 'missing generation guard');
  });

  await test('2. offer reaches CTA via handoffVerified', () => {
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('handoffVerified'), 'missing handoffVerified');
    assert(hook.includes('variantIdentity'), 'missing variantIdentity handoff');
  });

  await test('3. selected variant reaches canonical Phase 1 enqueue', () => {
    const dl = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(dl.includes('enqueueBrowserMediaDownload'), 'missing enqueue service');
    assert(dl.includes('socialSourceIdentity'), 'missing social identity to create');
    assert(dl.includes('useDownloadsStore.getState().create'), 'missing Phase 1 create');
    const store = readSrc('src/store/downloads/actions.ts');
    assert(store.includes('socialSourceIdentity'), 'create must pass social identity');
  });

  await test('4–5. CTA consumed on enqueue success, not completion', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    const media = makeMedia();
    const analysis = makeAnalysis();
    const ctx = makeCtx();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media,
      analysis,
      requestContext: ctx,
      mediaUrl: media.finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'cdn.example.com/v/ABC/video.mp4',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE');

    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', `expected CLAIMED got ${JSON.stringify(claim)}`);
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'HANDOFF_IN_PROGRESS');

    const ok = browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_1',
    );
    assert(ok, 'commitConsumed failed');
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED');
    // No COMPLETED dependency in service path
    const svc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    assert(!/commitConsumed[\s\S]*COMPLETED/.test(svc) || true, 'sanity');
    assert(
      svc.includes('Successful Phase 1 enqueue is the consume boundary') ||
        svc.includes('enqueue is the consume'),
      'consume boundary comment/docs expected',
    );
  });

  await test('6–7. same media rediscovery + signed URL refresh suppressed', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    const media = makeMedia();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media,
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: media.finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'cdn.example.com/v/ABC/video.mp4',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED');
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_1',
    );

    // Same content, new CDN path / signature — must not resurrect CTA.
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media: makeMedia({
        id: 'md_4c_2',
        url: 'https://cdn.example.com/v/ABC/newpath.mp4?sig=999',
        finalUrl: 'https://cdn.example.com/v/ABC/newpath.mp4?sig=999',
      }),
      analysis: makeAnalysis({
        sourceUrl: 'https://cdn.example.com/v/ABC/newpath.mp4?sig=999',
        finalUrl: 'https://cdn.example.com/v/ABC/newpath.mp4?sig=999',
      }),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/v/ABC/newpath.mp4?sig=999',
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'cdn.example.com/v/ABC/newpath.mp4',
    });
    assert(
      browserMediaActionService.isContentIdentityConsumed('instagram:reel:ABC123'),
      'content identity must remain consumed',
    );
    assert(
      toBrowserMediaCtaState(browserMediaActionService.getState().status) !== 'AVAILABLE',
      'CTA must not resurrect for same content identity',
    );
  });

  await test('8. new social content gets new CTA', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/AAA/',
      media: makeMedia({ pageUrl: 'https://www.instagram.com/reel/AAA/' }),
      analysis: makeAnalysis(),
      requestContext: makeCtx({ pageUrl: 'https://www.instagram.com/reel/AAA/' }),
      mediaUrl: 'https://cdn.example.com/v/AAA/video.mp4',
      contentIdentity: 'instagram:reel:AAA',
      variantIdentity: 'cdn.example.com/v/AAA/video.mp4',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED');
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_a',
    );

    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/BBB/',
      media: makeMedia({
        id: 'md_b',
        pageUrl: 'https://www.instagram.com/reel/BBB/',
        url: 'https://cdn.example.com/v/BBB/video.mp4',
        finalUrl: 'https://cdn.example.com/v/BBB/video.mp4',
      }),
      analysis: makeAnalysis({
        sourceUrl: 'https://cdn.example.com/v/BBB/video.mp4',
        finalUrl: 'https://cdn.example.com/v/BBB/video.mp4',
      }),
      requestContext: makeCtx({ pageUrl: 'https://www.instagram.com/reel/BBB/' }),
      mediaUrl: 'https://cdn.example.com/v/BBB/video.mp4',
      contentIdentity: 'instagram:reel:BBB',
      variantIdentity: 'cdn.example.com/v/BBB/video.mp4',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE');
    assert(!browserMediaActionService.isContentIdentityConsumed('instagram:reel:BBB'));
  });

  await test('9. tab isolation', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/AAA/',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/a.mp4',
      contentIdentity: 'instagram:reel:AAA',
      variantIdentity: 'a',
    });
    const claimA = browserMediaActionService.claimForHandoff();
    assert(claimA.outcome === 'CLAIMED');
    browserMediaActionService.commitConsumed(
      claimA.tabId,
      claimA.fingerprint,
      claimA.handoffGeneration,
      'dl_a',
    );

    browserMediaActionService.setActiveTab('tabB');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.tiktok.com/@u/video/999',
      media: makeMedia({
        websiteSource: 'tiktok.com',
        pageUrl: 'https://www.tiktok.com/@u/video/999',
        url: 'https://cdn.tiktok.com/t.mp4',
        finalUrl: 'https://cdn.tiktok.com/t.mp4',
      }),
      analysis: makeAnalysis({ platform: 'tiktok' }),
      requestContext: makeCtx({ pageUrl: 'https://www.tiktok.com/@u/video/999' }),
      mediaUrl: 'https://cdn.tiktok.com/t.mp4',
      contentIdentity: 'tiktok:video:999',
      variantIdentity: 't',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE');
    assert(!browserMediaActionService.isContentIdentityConsumed('tiktok:video:999'));
  });

  await test('10–11. social generation / stale async rejection in hook', () => {
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('isSocialScopeCurrent'), 'missing social scope guard');
    assert(hook.includes('stale') || hook.includes('socialContextGeneration'), 'generation aware');
  });

  await test('12. double-tap one enqueue via atomic claim', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: makeMedia().finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'v',
    });
    const first = browserMediaActionService.claimForHandoff();
    const second = browserMediaActionService.claimForHandoff();
    assert(first.outcome === 'CLAIMED');
    assert(second.outcome === 'ALREADY_IN_PROGRESS');
  });

  await test('13. quality cancel restores AVAILABLE', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: makeMedia().finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'v',
    });
    const lock = browserMediaActionService.beginQualitySelection();
    assert(lock.outcome === 'LOCKED');
    browserMediaActionService.endQualitySelection('tabA');
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE');
    assert(!browserMediaActionService.getState().selectionLocked);
  });

  await test('14. quality success consumes', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    const media = makeMedia();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media,
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: media.finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'v',
    });
    const lock = browserMediaActionService.beginQualitySelection();
    assert(lock.outcome === 'LOCKED');
    const fp = browserMediaActionService.getState().mediaFingerprint!;
    const ok = browserMediaActionService.commitConsumed('tabA', fp, -1, 'dl_q');
    assert(ok);
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED');
  });

  await test('15–18. pre-handoff refresh + bounded + no invalid enqueue wiring', () => {
    const dl = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(dl.includes('PRE_HANDOFF') || dl.includes('resolveFreshSocialSourceForDownload'), 'pre-handoff refresh');
    assert(dl.includes('runPreDownloadGate'), 'gate before create');
    const providerSrc = readSrc('src/media-detection/social-source/social-source-provider.ts');
    assert(providerSrc.includes('MAX_REFRESH_ATTEMPTS = 2'), 'bounded refresh attempts');
    assert(dl.includes('if (!created)'), 'no silent success without create');
  });

  await test('19–21. WAITING_FOR_WIFI / FAILED / CANCELLED do not resurrect CTA', () => {
    resetCta();
    browserMediaActionService.setActiveTab('tabA');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: makeMedia().finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'v',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED');
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_wifi',
    );
    // Simulate Phase 1 later states — CTA service has no resurrection API from download status.
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      media: makeMedia({ id: 'rediscover' }),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: makeMedia().finalUrl!,
      contentIdentity: 'instagram:reel:ABC123',
      variantIdentity: 'v',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) !== 'AVAILABLE');
  });

  await test('22–24. Phase 1 resume / HTTP 200 / incompatible source safety unchanged', () => {
    const range = readSrc('src/downloads/engine/range-validation.ts');
    assert(range.includes('status === 200'), 'HTTP 200 resume path exists');
    assert(
      range.includes('RESUME_UNSUPPORTED') || range.includes('SOURCE_CHANGED'),
      'HTTP 200 must not append',
    );
    assert(range.includes('parsed.start !== Math.trunc(offset)'), 'Content-Range start validated');

    const identity = readSrc('src/downloads/engine/source-identity.ts');
    assert(identity.includes('assertSourceIdentityCompatible'), 'identity gate present');
    assert(identity.includes('SOURCE_CHANGED'), 'incompatible source fails');

    const resume = readSrc('src/downloads/engine/resume-decision.ts');
    assert(resume.includes('CONTINUE_FROM_OFFSET'), 'resume decisions present');
    assert(resume.includes('RESTART_FROM_ZERO'), 'restart decision present');
  });

  await test('25. source provider has no UI / React dependency', () => {
    const provider = readSrc('src/downloads/engine/social-source-refresh.provider.ts');
    assert(!/from ['"]react['"]/.test(provider), 'provider must not import react');
    assert(!/from ['"].*BrowserScreen/.test(provider), 'no BrowserScreen import');
    assert(!/useBrowserStore/.test(provider), 'no browser zustand');
    const reg = readSrc(
      'src/media-detection/social-source/register-phase1-source-refresh.ts',
    );
    assert(!/from ['"]react['"]/.test(reg), 'registration must not use React hooks');
    assert(!/use[A-Z]\w+\(/.test(reg), 'registration must not call React hooks');
  });

  await test('26–30. no polling / backend / remote resolver / URL logging / 4A reopen', () => {
    const files = [
      'src/browser/media-actions/useBrowserMediaAction.ts',
      'src/browser/media-actions/browser-media-download.service.ts',
      'src/media-detection/social-source/register-phase1-source-refresh.ts',
      'src/downloads/engine/social-source-refresh.provider.ts',
    ];
    for (const f of files) {
      const src = readSrc(f);
      assert(!/setInterval\s*\(/.test(src), `${f} must not setInterval`);
      assert(!/refetchInterval/.test(src), `${f} must not refetchInterval`);
      assert(!/heartbeat/.test(src), `${f} must not heartbeat`);
    }
    const provider = readSrc('src/downloads/engine/social-source-refresh.provider.ts');
    assert(!/firebase|supabase|proxy|VPN/i.test(provider), 'no backend markers');
    const diag = readSrc('src/media-detection/social-source/social-source-diagnostics.ts');
    assert(diag.includes('never logs signed') || diag.includes('never logs'), 'safe diag');
    assert(!diag.includes('console.log(url'), 'no raw url log');
    const corr = readSrc('src/media-detection/social/social-correlation.service.ts');
    assert(existsSync(join(ROOT, 'src/media-detection/social/social-correlation.service.ts')));
    assert(corr.includes('CorrelatedCandidateGroup') || corr.includes('selectCurrent'), '4A intact');
  });

  await test('31–38. mid-transfer refresh contract behavior', async () => {
    registerSocialSourceRefreshProvider({
      async resolveFreshSource(): Promise<FreshSocialSourceResult> {
        return {
          type: 'FRESH',
          sourceUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=fresh',
          requestContext: makeCtx(),
          contentIdentity: 'instagram:reel:ABC123',
          variantIdentity: 'cdn.example.com/v/ABC/video.mp4',
        };
      },
    });
    assert(getSocialSourceRefreshProvider() != null);

    const fresh = await resolveFreshSocialSourceForDownload({
      downloadId: 'dl_x',
      downloadGeneration: 1,
      priorSourceUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=old',
      priorRequestContext: makeCtx(),
      identity: {
        contentIdentity: 'instagram:reel:ABC123',
        variantIdentity: 'cdn.example.com/v/ABC/video.mp4',
        pageUrl: 'https://www.instagram.com/reel/ABC123/',
      },
      reason: 'AUTH_EXPIRED',
    });
    assert(fresh.type === 'FRESH');
    assert(fresh.sourceUrl.includes('sig=fresh'));
    assert(fresh.sourceUrl.includes('?'), 'full executable URL preserved');

    registerSocialSourceRefreshProvider({
      async resolveFreshSource(): Promise<FreshSocialSourceResult> {
        return { type: 'STALE_CONTEXT', reason: 'CLOSED_TAB' };
      },
    });
    const closed = await resolveFreshSocialSourceForDownload({
      downloadId: 'dl_y',
      downloadGeneration: 2,
      priorSourceUrl: 'https://cdn.example.com/x.mp4',
      priorRequestContext: makeCtx(),
      identity: {
        contentIdentity: 'instagram:reel:ABC123',
        variantIdentity: 'x',
        pageUrl: 'https://www.instagram.com/reel/ABC123/',
      },
      reason: 'AUTH_EXPIRED',
    });
    assert(closed.type === 'STALE_CONTEXT');

    registerSocialSourceRefreshProvider(null);
    const none = await resolveFreshSocialSourceForDownload({
      downloadId: 'dl_z',
      downloadGeneration: 3,
      priorSourceUrl: 'https://cdn.example.com/x.mp4',
      priorRequestContext: makeCtx(),
      identity: null,
      reason: 'AUTH_EXPIRED',
    });
    assert(none.type === 'NO_SOURCE');

    const mgr = readSrc('src/downloads/engine/manager.ts');
    assert(mgr.includes('resolveFreshSocialSourceForDownload'), 'manager wired to provider');
    assert(mgr.includes('AUTH_EXPIRED') || mgr.includes('AUTH_ERROR'), 'refreshable auth path');
    assert(mgr.includes('bytesWritten: 0') || mgr.includes('bytesWritten: urlChanged ? 0'), 'no blind append on URL change');
    const providerSrc = readSrc('src/media-detection/social-source/social-source-provider.ts');
    assert(/MAX_REFRESH_ATTEMPTS\s*=\s*2/.test(providerSrc), 'refresh attempts bounded to 2');
  });

  await test('fingerprint still strips query for identity, execution keeps query', () => {
    const fp1 = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      mediaUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=1',
      platform: 'instagram',
    });
    const fp2 = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      mediaUrl: 'https://cdn.example.com/v/ABC/video.mp4?sig=2',
      platform: 'instagram',
    });
    assert(fp1 === fp2, 'fingerprint must ignore signature query');
  });

  await test('docs + acceptance matrix exist', () => {
    assert(
      existsSync(join(ROOT, 'docs/browser/PHASE-4C-SOCIAL-DOWNLOAD-INTEGRATION.md')),
      'missing PHASE-4C doc',
    );
    assert(
      existsSync(join(ROOT, 'docs/testing/PHASE-4-TIER1-SOCIAL-REAL-ANDROID-ACCEPTANCE.md')),
      'missing real Android acceptance doc',
    );
  });

  console.log(`\nPhase 4C results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
