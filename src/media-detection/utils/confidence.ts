import { CONFIDENCE, STRONG_VIDEO_EXTENSIONS, STREAM_EXTENSIONS } from '../constants';
import type { MediaCandidate } from '../types';
import { parseExtensionFromUrl } from '../parsers/extension.parser';
import { isDashMimeType } from '../parsers/dash.parser';
import { isHlsMimeType } from '../parsers/hls.parser';

const STRONG_EXT = new Set<string>([
  ...STRONG_VIDEO_EXTENSIONS,
  ...STREAM_EXTENSIONS,
  'mp3',
  'm4a',
  'aac',
  'ogg',
]);

/**
 * Deterministic confidence score from available evidence.
 * Never fabricates signals — only boosts for present, validated fields.
 */
export function scoreConfidence(candidate: MediaCandidate): number {
  if (typeof candidate.confidenceHint === 'number' && candidate.confidenceHint <= 0.3) {
    // Keyword-only path — keep low unless stronger signals exist below.
  }

  let score = candidate.confidenceHint ?? CONFIDENCE.baseUrlMatch;

  const ext = candidate.extension ?? parseExtensionFromUrl(candidate.url);
  if (ext && STRONG_EXT.has(ext)) {
    score += CONFIDENCE.strongExtBoost;
  }

  if (candidate.mimeType) {
    const base = candidate.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (
      base.startsWith('video/') ||
      isHlsMimeType(base) ||
      isDashMimeType(base)
    ) {
      score += CONFIDENCE.mimeVerifiedBoost;
    } else {
      score += CONFIDENCE.mimeBoost;
    }
  }

  if (
    candidate.detectionSource === 'dom_video' ||
    candidate.detectionSource === 'dom_audio' ||
    candidate.detectionSource === 'dom_source'
  ) {
    score += CONFIDENCE.domElementBoost;
  }

  if (
    candidate.detectionSource === 'native_network' ||
    candidate.detectionSource === 'mime_probe'
  ) {
    score += CONFIDENCE.nativeNetworkBoost;
  }

  if (
    candidate.detectionSource === 'js_fetch' ||
    candidate.detectionSource === 'js_xhr'
  ) {
    score += CONFIDENCE.jsNetworkBoost;
  }

  if (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    candidate.width > 0 &&
    candidate.height > 0
  ) {
    score += CONFIDENCE.dimensionsBoost;
  }

  if (typeof candidate.duration === 'number' && candidate.duration > 0) {
    score += CONFIDENCE.durationBoost;
  }

  if (candidate.detectionSource === 'manifest') {
    score += CONFIDENCE.manifestBoost;
  }

  if (
    candidate.playlistType === 'master' ||
    candidate.playlistType === 'media' ||
    candidate.streamProtocol === 'hls' ||
    candidate.streamProtocol === 'dash'
  ) {
    // Soft boost for stream classification — full verified boost applied after parse.
    if (candidate.confidenceHint == null || candidate.confidenceHint < 0.8) {
      score += 0.05;
    }
  }

  return Math.min(CONFIDENCE.max, Math.max(0, Number(score.toFixed(3))));
}

export function scoreVerifiedManifest(base: number): number {
  return Math.min(
    CONFIDENCE.max,
    Number((base + CONFIDENCE.manifestVerifiedBoost).toFixed(3)),
  );
}
