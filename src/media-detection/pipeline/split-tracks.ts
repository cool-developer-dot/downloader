/**
 * Split audio/video players (a MediaSource fed from a video-only and an audio-only file): proves which two files are
 * the video and the audio of the video on screen, so the engine can download both and merge them.
 *
 * Never a guess. The exact pair comes from the page itself when it can name the file behind each SourceBuffer
 * (`buffers`); otherwise only a player fed from exactly two files is resolved (`network`) — with more candidates
 * (a feed prefetching the next item's tracks) nothing is offered rather than risking another video's audio. Either
 * way the native classifier then proves the pair from the files' own bytes: a picture in the video file, sound in
 * the audio file, nothing encrypted, and lengths that agree with each other and with the element on screen.
 */
import type { ProbeFailure, ProbeRequest, ProbeResult, RequestContext } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaAnalysisResult } from '@/api/types';
import { applyPrimarySummary, createVariant } from '@/downloads/analyze/format';

import type { PipelineOutcome } from './pipeline-outcome';

/** Query parameters that select a byte range of the file rather than a different file. */
const BYTE_RANGE_PARAMS = new Set(['bytestart', 'byteend', 'range', 'rn', 'rbuf']);

/** Tracks of one video end within this of each other and of the element (encoders pad audio; players trim). */
const MIN_LENGTH_SLACK_MS = 1_500;
const LENGTH_SLACK_FRACTION = 0.05;

export type SplitTrackEvidence = {
  source: 'buffers' | 'network';
  videoUrl: string | null;
  audioUrl: string | null;
  /** `network`: the whole-file URLs requested while the player was active, newest first. */
  candidateUrls: string[];
  /** The element's duration, when the page reported it. */
  durationMs: number | null;
};

export type SplitPair = {
  videoUrl: string;
  audioUrl: string;
  probe: Extract<ProbeResult, { ok: true }>;
};

export type SplitPairFailure = {
  outcome: PipelineOutcome;
  reason: string;
  /** Proven from the files themselves (a final verdict), rather than "not resolved yet". */
  proven: boolean;
};

export type SplitPairResult = { ok: true; pair: SplitPair } | { ok: false; failure: SplitPairFailure };

/**
 * The whole file a ranged request reads: byte-range query parameters removed, everything else (signatures included)
 * kept exactly as the page requested it.
 */
export function wholeFileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (BYTE_RANGE_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

export function lengthsAgree(aMs: number, bMs: number): boolean {
  const slack = Math.max(MIN_LENGTH_SLACK_MS, Math.max(aMs, bMs) * LENGTH_SLACK_FRACTION);
  return Math.abs(aMs - bMs) <= slack;
}

function failureFor(reason: ProbeFailure): SplitPairFailure {
  switch (reason) {
    case 'DRM_PROTECTED':
      return { outcome: 'PROTECTED', reason, proven: true };
    case 'VIDEO_TRACK_MISSING':
      return { outcome: 'VIDEO_TRACK_MISSING', reason, proven: true };
    case 'AUDIO_TRACK_MISSING':
      return { outcome: 'AUDIO_TRACK_MISSING', reason, proven: true };
    case 'TRACK_MISMATCH':
      return { outcome: 'STALE', reason, proven: false };
    case 'NETWORK':
    case 'HTTP_ERROR':
      return { outcome: 'TRANSIENT_FAILURE', reason, proven: false };
    case 'HTTP_403':
    case 'HTTP_404':
      return { outcome: 'SOURCE_UNRESOLVED', reason, proven: false };
    case 'LIVE_UNSUPPORTED':
      return { outcome: 'LIVE_UNSUPPORTED', reason, proven: true };
    default:
      return { outcome: 'UNSUPPORTED', reason, proven: true };
  }
}

async function probePair(
  probe: (request: ProbeRequest) => Promise<ProbeResult>,
  videoUrl: string,
  audioUrl: string,
  request: RequestContext,
): Promise<ProbeResult> {
  try {
    return await probe({ url: videoUrl, kind: 'split', audioUrl, request });
  } catch {
    return { ok: false, reason: 'NETWORK', httpStatus: null, message: null };
  }
}

/** The pair must also be the element's own video: its length agrees with what the element plays. */
function matchesElement(result: Extract<ProbeResult, { ok: true }>, durationMs: number | null): boolean {
  if (durationMs == null || result.durationMs == null) {
    return true;
  }
  return lengthsAgree(result.durationMs, durationMs);
}

export async function resolveSplitPair(input: {
  evidence: SplitTrackEvidence;
  probe: (request: ProbeRequest) => Promise<ProbeResult>;
  request: RequestContext;
  signal?: AbortSignal;
}): Promise<SplitPairResult> {
  const { evidence, request } = input;
  const stale: SplitPairResult = { ok: false, failure: { outcome: 'STALE', reason: 'ABORTED', proven: false } };

  if (evidence.source === 'buffers') {
    if (!evidence.videoUrl || !evidence.audioUrl) {
      return { ok: false, failure: { outcome: 'SOURCE_UNRESOLVED', reason: 'SPLIT_FILES_UNKNOWN', proven: false } };
    }
    const videoUrl = wholeFileUrl(evidence.videoUrl);
    const audioUrl = wholeFileUrl(evidence.audioUrl);
    const result = await probePair(input.probe, videoUrl, audioUrl, request);
    if (input.signal?.aborted) {
      return stale;
    }
    if (!result.ok) {
      return { ok: false, failure: failureFor(result.reason) };
    }
    if (!matchesElement(result, evidence.durationMs)) {
      return { ok: false, failure: { outcome: 'STALE', reason: 'SPLIT_LENGTH_NOT_ELEMENT', proven: false } };
    }
    return { ok: true, pair: { videoUrl, audioUrl, probe: result } };
  }

  // Network evidence only: exactly two files, or nothing — a third file may belong to the next video.
  const files = [...new Set(evidence.candidateUrls.map(wholeFileUrl))];
  if (files.length !== 2) {
    return {
      ok: false,
      failure: { outcome: 'SOURCE_UNRESOLVED', reason: files.length > 2 ? 'SPLIT_AMBIGUOUS' : 'SPLIT_FILES_UNKNOWN', proven: false },
    };
  }
  let last: SplitPairFailure | null = null;
  for (const [videoUrl, audioUrl] of [
    [files[0], files[1]],
    [files[1], files[0]],
  ] as const) {
    const result = await probePair(input.probe, videoUrl, audioUrl, request);
    if (input.signal?.aborted) {
      return stale;
    }
    if (result.ok) {
      if (!matchesElement(result, evidence.durationMs)) {
        return { ok: false, failure: { outcome: 'STALE', reason: 'SPLIT_LENGTH_NOT_ELEMENT', proven: false } };
      }
      return { ok: true, pair: { videoUrl, audioUrl, probe: result } };
    }
    last = failureFor(result.reason);
    // Only a wrong role is worth trying the other way round; anything else is the answer.
    if (result.reason !== 'VIDEO_TRACK_MISSING' && result.reason !== 'AUDIO_TRACK_MISSING') {
      return { ok: false, failure: last };
    }
  }
  return { ok: false, failure: last ?? { outcome: 'SOURCE_UNRESOLVED', reason: 'SPLIT_FILES_UNKNOWN', proven: false } };
}

/** The offer for a proven pair: one option whose video file is merged with its audio file (`kind: 'split'`). */
export function splitPairAnalysis(
  pair: SplitPair,
  info: { title: string | null; thumbnailUrl: string | null; platform: string },
): MediaAnalysisResult {
  const variant = pair.probe.variants[0];
  const width = variant?.width ?? null;
  const height = variant?.height ?? null;
  const size = pair.probe.sizeBytes ?? null;
  const variants = [
    createVariant({
      sourceUrl: pair.videoUrl,
      audioSourceUrl: pair.audioUrl,
      streamType: 'PROGRESSIVE',
      container: 'mp4',
      mimeType: 'video/mp4',
      width,
      height,
      estimatedFileSize: size,
      downloadable: true,
      unsupportedReason: null,
      originalIndex: 0,
    }),
  ];
  return applyPrimarySummary(
    {
      title: info.title,
      sourceUrl: pair.videoUrl,
      finalUrl: pair.videoUrl,
      thumbnailUrl: info.thumbnailUrl,
      mediaType: 'video',
      mimeType: 'video/mp4',
      container: 'mp4',
      duration: pair.probe.durationMs != null ? pair.probe.durationMs / 1000 : null,
      width,
      height,
      resolution: width && height ? `${width}x${height}` : null,
      bitrate: null,
      fps: null,
      fileSize: size != null ? String(size) : null,
      platform: info.platform,
      downloadable: true,
      unsupportedReason: null,
      variants: [],
    } as MediaAnalysisResult,
    variants,
  );
}
