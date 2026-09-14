import { CONFIDENCE, DETECTION_TIMING } from '../constants';
import {
  extractDetectedMedia,
  extractFromDomCandidate,
  extractPageMetadata,
} from '../extractors';
import {
  isDashManifestUrl,
  mapDashRepresentationsToQualities,
  mapHlsVariantsToQualities,
  parseProgressiveMediaUrl,
} from '../parsers';
import type {
  BridgeMediaCandidatePayload,
  BridgeMutationBatchPayload,
  BridgePageMetaPayload,
  DetectedMedia,
  MediaCandidate,
  MediaQualityVariant,
  PageMediaMetadata,
} from '../types';
import { validateMediaCandidate, isAcceptableConfidence } from '../validators';
import { scoreVerifiedManifest } from '../utils/confidence';
import {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from './automatic-handoff-diagnostics';
import { dedupeUpsert } from './deduplication.service';
import { isFalsePositive } from './false-positive.filter';
import { classifyGeneralNetworkResource } from '../general-media/general-network-resource';
import {
  enrichDashFromUrl,
  enrichHlsFromUrl,
  shouldEnrichAsDash,
} from './manifest.service';
import {
  clearMimeProbeCache,
  isVerifiedMediaMime,
  probeMediaMime,
} from './mime-probe.service';
import { resolveRedirects } from './redirect.resolver';

export type PipelineResult = {
  media: DetectedMedia[];
  qualities: MediaQualityVariant[];
  pageMetadata: PageMediaMetadata | null;
  inserted: number;
  updated: number;
  rejected: number;
  durationMs: number;
  /** Candidates that need async MIME/manifest enrichment. */
  pendingProbeUrls: string[];
};

/**
 * Event-driven detection pipeline:
 * Collect → Filter → Validate → Dedup → (async) Resolve/Probe/Parse
 */
export class MediaDetectionPipeline {
  private abortController: AbortController | null = null;
  private enriching = new Set<string>();
  private probedThisPage = 0;
  private segmentUriBlocklist = new Set<string>();

  reset(): void {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.enriching.clear();
    this.probedThisPage = 0;
    this.segmentUriBlocklist.clear();
    clearMimeProbeCache();
  }

  get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  isSegmentBlocked(url: string): boolean {
    return this.segmentUriBlocklist.has(url);
  }

  processCandidates(
    existing: DetectedMedia[],
    candidates: MediaCandidate[],
    existingQualities: MediaQualityVariant[] = [],
  ): PipelineResult {
    const started = Date.now();
    let items = existing;
    let qualities = existingQualities;
    let inserted = 0;
    let updated = 0;
    let rejected = 0;
    const pendingProbeUrls: string[] = [];

    for (const raw of candidates) {
      if (this.segmentUriBlocklist.has(raw.url)) {
        rejected += 1;
        continue;
      }

      if (
        isFalsePositive({
          url: raw.url,
          mimeType: raw.mimeType,
          confidenceHint: raw.confidenceHint,
        })
      ) {
        rejected += 1;
        continue;
      }

      const validated = validateMediaCandidate(raw);
      if (!validated.ok) {
        rejected += 1;
        continue;
      }

      const detected = extractDetectedMedia(validated.value);
      if (!detected) {
        rejected += 1;
        continue;
      }

      if (!isAcceptableConfidence(detected.confidence)) {
        // Queue extensionless / low-confidence for MIME probe when probeable.
        if (this.shouldQueueProbe(detected)) {
          pendingProbeUrls.push(detected.url);
        }
        rejected += 1;
        continue;
      }

      const result = dedupeUpsert(
        items,
        detected,
        DETECTION_TIMING.maxDetectedPerPage,
      );
      items = result.items;
      if (result.inserted) {
        inserted += 1;
        logAutomaticHandoff('MEDIA_CANDIDATE_OBSERVED', {
          candidateIdHash: hashHandoffIdentity(detected.id),
          detectionSource: detected.detectionSource,
          streamType: detected.streamType,
          container: detected.container ?? null,
          confidence: Number(detected.confidence.toFixed(3)),
        });
      } else if (result.updated) {
        updated += 1;
        logAutomaticHandoff('MEDIA_CANDIDATE_DEDUPED', {
          candidateIdHash: hashHandoffIdentity(detected.id),
          detectionSource: detected.detectionSource,
        });
      }

      if (this.shouldQueueProbe(detected) && !detected.mimeType) {
        pendingProbeUrls.push(detected.url);
      }
    }

    return {
      media: items,
      qualities,
      pageMetadata: null,
      inserted,
      updated,
      rejected,
      durationMs: Date.now() - started,
      pendingProbeUrls,
    };
  }

  processBridgeBatch(
    existing: DetectedMedia[],
    batch: BridgeMutationBatchPayload,
    existingQualities: MediaQualityVariant[] = [],
  ): PipelineResult {
    const candidates: MediaCandidate[] = [];

    for (const payload of batch.candidates.slice(
      0,
      DETECTION_TIMING.maxCandidatesPerBatch,
    )) {
      const candidate = extractFromDomCandidate(payload);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return this.processCandidates(existing, candidates, existingQualities);
  }

  processBridgeCandidate(
    existing: DetectedMedia[],
    payload: BridgeMediaCandidatePayload,
    existingQualities: MediaQualityVariant[] = [],
  ): PipelineResult {
    const candidate = extractFromDomCandidate(payload);
    if (!candidate) {
      return {
        media: existing,
        qualities: existingQualities,
        pageMetadata: null,
        inserted: 0,
        updated: 0,
        rejected: 1,
        durationMs: 0,
        pendingProbeUrls: [],
      };
    }
    return this.processCandidates(existing, [candidate], existingQualities);
  }

  processPageMeta(payload: BridgePageMetaPayload): PageMediaMetadata | null {
    return extractPageMetadata(payload);
  }

  processNetworkUrl(
    existing: DetectedMedia[],
    url: string,
    pageUrl: string,
    existingQualities: MediaQualityVariant[] = [],
    extras?: {
      mimeType?: string | null;
      detectionSource?: MediaCandidate['detectionSource'];
      requiresCookies?: boolean;
      hasRange?: boolean;
      isForMainFrame?: boolean;
    },
  ): PipelineResult {
    if (this.segmentUriBlocklist.has(url)) {
      return emptyResult(existing, existingQualities, 1);
    }

    const candidate = parseProgressiveMediaUrl({
      url,
      pageUrl,
      mimeType: extras?.mimeType,
      detectionSource: extras?.detectionSource ?? 'network_request',
      requiresCookies: extras?.requiresCookies,
      hasRange: extras?.hasRange,
      isForMainFrame: extras?.isForMainFrame,
      requiredHeaders:
        extras?.requiresCookies || pageUrl
          ? {
              referer: pageUrl,
              hasCookies: Boolean(extras?.requiresCookies),
            }
          : undefined,
    });

    if (!candidate) {
      return {
        ...emptyResult(existing, existingQualities, 0),
        pendingProbeUrls: looksProbeable(url, extras?.mimeType, extras?.hasRange)
          ? [url]
          : [],
      };
    }

    return this.processCandidates(existing, [candidate], existingQualities);
  }

  /**
   * Lazy HLS enrichment — fetches manifest off the critical path.
   */
  async enrichHlsMedia(
    media: DetectedMedia,
  ): Promise<{ media: DetectedMedia; qualities: MediaQualityVariant[] } | null> {
    if (media.container !== 'hls' || media.isDrm) {
      return null;
    }

    if (this.enriching.has(media.id)) {
      return null;
    }

    this.enriching.add(media.id);
    try {
      const parsed = await enrichHlsFromUrl(media.url, this.signal, media.pageUrl);
      if (!parsed) {
        return null;
      }

      for (const seg of parsed.segmentUris) {
        this.segmentUriBlocklist.add(seg);
      }

      if (parsed.isEncrypted) {
        return {
          media: {
            ...media,
            isDrm: true,
            downloadable: false,
            playlistType: parsed.playlistType,
            isLive: parsed.isLive,
            finalUrl: parsed.finalUrl,
            url: parsed.finalUrl,
          },
          qualities: [],
        };
      }

      const qualities = mapHlsVariantsToQualities(media.id, parsed.variants);
      const codec = parsed.variants[0]?.codecs ?? media.codec;

      return {
        media: {
          ...media,
          playlistType: parsed.playlistType,
          isLive: parsed.isLive,
          streamType: 'HLS',
          streamProtocol: 'hls',
          finalUrl: parsed.finalUrl,
          url: parsed.finalUrl,
          codec,
          fps: parsed.variants[0]?.frameRate ?? media.fps,
          confidence: scoreVerifiedManifest(media.confidence),
          downloadable: !parsed.isLive,
        },
        qualities,
      };
    } finally {
      this.enriching.delete(media.id);
    }
  }

  async enrichDashMedia(
    media: DetectedMedia,
  ): Promise<{ media: DetectedMedia; qualities: MediaQualityVariant[] } | null> {
    if (media.container !== 'dash' || media.isDrm) {
      return null;
    }
    if (this.enriching.has(media.id)) {
      return null;
    }

    this.enriching.add(media.id);
    try {
      const parsed = await enrichDashFromUrl(media.url, this.signal);
      if (!parsed) {
        return null;
      }

      if (parsed.isEncrypted) {
        return {
          media: {
            ...media,
            isDrm: true,
            downloadable: false,
            streamType: 'DASH',
            streamProtocol: 'dash',
            finalUrl: parsed.finalUrl,
            url: parsed.finalUrl,
          },
          qualities: [],
        };
      }

      const qualities = mapDashRepresentationsToQualities(media.id, parsed);
      const top = parsed.videoRepresentations[0] ?? parsed.representations[0];

      return {
        media: {
          ...media,
          streamType: 'DASH',
          streamProtocol: 'dash',
          finalUrl: parsed.finalUrl,
          url: parsed.finalUrl,
          width: top?.width ?? media.width,
          height: top?.height ?? media.height,
          resolution:
            top?.width && top?.height
              ? `${top.width}x${top.height}`
              : media.resolution,
          fps: top?.frameRate ?? media.fps,
          codec: top?.codecs ?? media.codec,
          bitrate: top?.bandwidth ?? media.bitrate,
          mimeType: top?.mimeType ?? media.mimeType,
          hasSeparateAudio: parsed.hasSeparateAudio,
          videoOnly: parsed.hasSeparateAudio,
          confidence: scoreVerifiedManifest(media.confidence),
          downloadable: true,
        },
        qualities,
      };
    } finally {
      this.enriching.delete(media.id);
    }
  }

  /**
   * MIME + redirect enrichment for extensionless / low-signal URLs.
   */
  async enrichWithMimeProbe(
    url: string,
    pageUrl: string,
    existing: DetectedMedia[],
    existingQualities: MediaQualityVariant[] = [],
  ): Promise<PipelineResult | null> {
    if (this.probedThisPage >= DETECTION_TIMING.maxProbesPerPage) {
      return null;
    }
    if (this.enriching.has(`probe:${url}`)) {
      return null;
    }

    this.enriching.add(`probe:${url}`);
    this.probedThisPage += 1;

    try {
      const redirects = await resolveRedirects(url, this.signal, {
        referer: pageUrl,
      });
      const targetUrl = redirects.ok ? redirects.finalUrl : url;

      const probe = await probeMediaMime(targetUrl, this.signal, {
        referer: pageUrl,
      });
      if (!probe?.ok || !isVerifiedMediaMime(probe.mimeType)) {
        return null;
      }

      const candidate = parseProgressiveMediaUrl({
        url: probe.finalUrl,
        pageUrl,
        mimeType: probe.mimeType,
        detectionSource: 'mime_probe',
        sourceUrl: url,
        finalUrl: probe.finalUrl,
        redirectCount: redirects.redirectCount,
        estimatedFileSize: probe.contentLength,
        confidenceHint: CONFIDENCE.mimeVerifiedBoost + CONFIDENCE.baseUrlMatch,
      });

      if (!candidate) {
        return null;
      }

      return this.processCandidates(existing, [candidate], existingQualities);
    } finally {
      this.enriching.delete(`probe:${url}`);
    }
  }

  needsManifestEnrichment(media: DetectedMedia): 'hls' | 'dash' | null {
    if (media.isDrm) {
      return null;
    }
    if (media.container === 'hls') {
      return 'hls';
    }
    if (media.container === 'dash' || shouldEnrichAsDash(media.url, media.mimeType)) {
      return 'dash';
    }
    if (isDashManifestUrl(media.url)) {
      return 'dash';
    }
    return null;
  }

  private shouldQueueProbe(detected: DetectedMedia): boolean {
    if (this.probedThisPage >= DETECTION_TIMING.maxProbesPerPage) {
      return false;
    }
    if (detected.mimeType && isVerifiedMediaMime(detected.mimeType)) {
      return false;
    }
    if (detected.container === 'hls' || detected.container === 'dash') {
      return false;
    }
    // Extensionless or unknown container.
    return !detected.extension || detected.container === 'unknown';
  }
}

function emptyResult(
  existing: DetectedMedia[],
  qualities: MediaQualityVariant[],
  rejected: number,
): PipelineResult {
  return {
    media: existing,
    qualities,
    pageMetadata: null,
    inserted: 0,
    updated: 0,
    rejected,
    durationMs: 0,
    pendingProbeUrls: [],
  };
}

function looksProbeable(
  url: string,
  mimeType?: string | null,
  hasRange?: boolean,
): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|ico)(?:[?#]|$)/i.test(u.pathname)) {
      return false;
    }
    const classified = classifyGeneralNetworkResource({
      url,
      mimeType,
      hasRange,
      isForMainFrame: false,
    });
    return classified.acceptForProbe || classified.acceptForIngest;
  } catch {
    return false;
  }
}

export const mediaDetectionPipeline = new MediaDetectionPipeline();
