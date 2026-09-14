/**
 * On-device media URL analyzer (Phase 1B).
 * Replaces mandatory POST /downloads/analyze for quality selection.
 *
 * Progressive + compatible unencrypted VOD HLS only.
 * Reuses engine HLS parse/reject rules. No DRM/encryption bypass.
 */

import type { MediaAnalysisResult, MediaAnalysisVariant } from '@/api/types';
import { DownloadEngineError } from '@/downloads/engine/errors';
import {
  fetchAndParseHlsPlaylist,
} from '@/downloads/engine/hls/fetch-playlist';
import {
  isPlaylistOrStreamUrl,
  isSafeHttpUrl,
} from '@/downloads/engine/resource-guard';
import { buildDownloadHeaders } from '@/downloads/engine/download-headers';
import { isSafeMediaUrl } from '@/media-detection/utils';

import { LOCAL_ANALYZE } from './constants';
import {
  applyPrimarySummary,
  contentLengthToEstimatedSize,
  createVariant,
  derivePlatform,
  emptyAnalysis,
  estimateHlsFileSizeBytes,
  extractFilenameFromContentDisposition,
  isHlsMimeType,
  isNonMediaDocumentMime,
  mapEngineErrorToReason,
  parseContentType,
  parseFileSize,
  resolveContainer,
  resolveExtension,
  resolveMediaType,
} from './format';
import {
  inspectSource,
  LocalAnalyzeNetworkError,
} from './probe';

export type AnalyzeUrlOptions = {
  signal?: AbortSignal;
  /** Optional Referer for page-context media (never persisted). */
  referer?: string | null;
  userAgent?: string | null;
  requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
};

function assertHttpOk(status: number): void {
  if (status >= 200 && status < 300) {
    return;
  }
  // Partial content is fine for Range probes.
  if (status === 206) {
    return;
  }
  throw new LocalAnalyzeNetworkError(
    'http',
    `Source returned HTTP ${status}`,
    status,
  );
}

async function analyzeHls(
  sourceUrl: string,
  finalUrl: string,
  mimeType: string | null,
  options?: AnalyzeUrlOptions,
): Promise<MediaAnalysisResult> {
  const hlsMime = mimeType ?? 'application/vnd.apple.mpegurl';
  const base = emptyAnalysis(sourceUrl, {
    finalUrl,
    mimeType: hlsMime,
    container: 'hls',
    mediaType: 'stream',
    platform: derivePlatform(finalUrl),
    downloadable: false,
    unsupportedReason: 'UNSUPPORTED_STREAM',
    variants: [],
  });

  try {
    // Prefer engine fetch+parse (same reject rules as transfer).
    const sessionHeaders = buildDownloadHeaders(options?.requestContext);
    const { playlist, finalUrl: playlistUrl } = await fetchAndParseHlsPlaylist(
      finalUrl,
      options?.signal ?? new AbortController().signal,
      sessionHeaders,
    );

    if (playlist.kind === 'master') {
      const drafts: MediaAnalysisVariant[] = [];
      const capped = playlist.variants.slice(0, LOCAL_ANALYZE.maxHlsVariants);
      capped.forEach((variant, index) => {
        if (!isSafeHttpUrl(variant.url)) {
          return;
        }
        drafts.push(
          createVariant({
            sourceUrl: variant.url,
            streamType: 'HLS',
            width: variant.width,
            height: variant.height,
            resolution: variant.resolution,
            bitrate: variant.bandwidth,
            averageBitrate: variant.averageBandwidth,
            codecs: variant.codecs,
            container: 'hls',
            mimeType: hlsMime,
            estimatedFileSize: estimateHlsFileSizeBytes(
              variant.averageBandwidth ?? variant.bandwidth,
              null,
            ),
            frameRate: variant.frameRate,
            downloadable: true,
            unsupportedReason: null,
            originalIndex: index,
          }),
        );
      });

      if (drafts.length === 0) {
        return {
          ...base,
          finalUrl: playlistUrl,
          unsupportedReason: 'UNSUPPORTED_STREAM',
        };
      }

      return applyPrimarySummary(
        {
          ...base,
          finalUrl: playlistUrl,
          unsupportedReason: null,
        },
        drafts,
      );
    }

    // Direct media playlist → single option.
    return applyPrimarySummary(
      {
        ...base,
        finalUrl: playlistUrl,
        unsupportedReason: null,
      },
      [
        createVariant({
          sourceUrl: playlistUrl,
          streamType: 'HLS',
          container: 'hls',
          mimeType: hlsMime,
          downloadable: true,
          unsupportedReason: null,
          originalIndex: 0,
        }),
      ],
    );
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      return {
        ...base,
        unsupportedReason: mapEngineErrorToReason(error.code),
      };
    }
    if (error instanceof LocalAnalyzeNetworkError) {
      return emptyAnalysis(sourceUrl, {
        finalUrl,
        unsupportedReason: 'NETWORK_ERROR',
      });
    }
    return {
      ...base,
      unsupportedReason: 'ANALYSIS_FAILED',
    };
  }
}

/**
 * Analyze a media URL on-device. Does not create downloads.
 * Returns a MediaAnalysisResult compatible with quality-selection UI.
 */
export async function analyzeMediaUrl(
  rawUrl: string,
  options?: AnalyzeUrlOptions,
): Promise<MediaAnalysisResult> {
  const trimmed = rawUrl.trim();
  if (!trimmed || !isSafeMediaUrl(trimmed) || !isSafeHttpUrl(trimmed)) {
    return emptyAnalysis(trimmed || rawUrl, {
      unsupportedReason: 'INVALID_URL',
    });
  }

  const sourceUrl = trimmed;

  try {
    const probe = await inspectSource(sourceUrl, options?.signal, {
      referer: options?.referer,
      userAgent: options?.userAgent,
      requestContext: options?.requestContext,
    });
    assertHttpOk(probe.status);

    const finalUrl = probe.finalUrl;
    if (!isSafeHttpUrl(finalUrl)) {
      return emptyAnalysis(sourceUrl, {
        unsupportedReason: 'INVALID_URL',
      });
    }

    const headerMime = parseContentType(probe.headers.contentType);
    const extension = resolveExtension(finalUrl, headerMime);
    const container = resolveContainer(extension, headerMime);
    const mediaType = resolveMediaType(container, headerMime);
    const mimeType = headerMime;
    const fileSize = parseFileSize(probe.headers.contentLength);
    const estimatedFileSize = contentLengthToEstimatedSize(
      probe.headers.contentLength,
    );
    const filename = extractFilenameFromContentDisposition(
      probe.headers.contentDisposition,
    );
    const platform = derivePlatform(finalUrl);

    const looksLikeHls =
      container === 'hls' ||
      isHlsMimeType(headerMime) ||
      isPlaylistOrStreamUrl(finalUrl);

    if (looksLikeHls) {
      return analyzeHls(sourceUrl, finalUrl, mimeType, options);
    }

    if (!mediaType || container === 'unknown') {
      const unsupportedReason = isNonMediaDocumentMime(headerMime)
        ? 'NO_MEDIA'
        : headerMime
          ? 'UNSUPPORTED_FORMAT'
          : 'NO_MEDIA';

      return emptyAnalysis(sourceUrl, {
        finalUrl,
        title: filename,
        mimeType: headerMime,
        container: 'unknown',
        mediaType: null,
        fileSize,
        platform,
        downloadable: false,
        unsupportedReason,
        variants: [],
      });
    }

    const streamType = mediaType === 'audio' ? 'AUDIO' : 'PROGRESSIVE';
    const variants = [
      createVariant({
        sourceUrl: finalUrl,
        streamType,
        container,
        mimeType,
        estimatedFileSize,
        downloadable: true,
        unsupportedReason: null,
        originalIndex: 0,
      }),
    ];

    return applyPrimarySummary(
      {
        title: filename,
        sourceUrl,
        finalUrl,
        thumbnailUrl: null,
        mediaType,
        mimeType,
        container,
        duration: null,
        width: null,
        height: null,
        resolution: null,
        bitrate: null,
        fps: null,
        fileSize,
        platform,
        downloadable: true,
        unsupportedReason: null,
        variants: [],
      },
      variants,
    );
  } catch (error) {
    if (error instanceof LocalAnalyzeNetworkError) {
      if (error.kind === 'aborted') {
        throw error;
      }
      if (error.kind === 'unsafe') {
        return emptyAnalysis(sourceUrl, {
          unsupportedReason: 'INVALID_URL',
        });
      }
      return emptyAnalysis(sourceUrl, {
        unsupportedReason: 'NETWORK_ERROR',
      });
    }

    if (
      error instanceof Error &&
      (error.name === 'AbortError' || options?.signal?.aborted)
    ) {
      throw error;
    }

    return emptyAnalysis(sourceUrl, {
      unsupportedReason: 'ANALYSIS_FAILED',
    });
  }
}
