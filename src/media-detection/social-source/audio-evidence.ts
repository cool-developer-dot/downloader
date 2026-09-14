/**
 * Evidence-driven audio state — never infer INCLUDED from .mp4 alone.
 */

import type { DetectedMedia } from '../types';
import type { SocialAudioState } from './types';

export function resolveSocialAudioState(media: DetectedMedia): SocialAudioState {
  if (media.category === 'audio') {
    return 'AUDIO_ONLY';
  }

  // Separate adaptive A/V without a muxer → not a combined download.
  if (media.videoOnly && media.hasSeparateAudio) {
    return 'VIDEO_ONLY';
  }

  if (media.videoOnly === true) {
    return 'VIDEO_ONLY';
  }

  const codec = media.audioCodec?.trim();
  if (codec) {
    // Explicit audio codec on this representation → INCLUDED for muxed progressive.
    if (!media.hasSeparateAudio) {
      return 'INCLUDED';
    }
    // Separate audio track observed on page — this video rep is still VIDEO_ONLY.
    return 'VIDEO_ONLY';
  }

  return 'UNKNOWN';
}

/**
 * Whether a variant is safe to present as a normal "Download Video" choice.
 * Video-only adaptive streams are excluded from combined-video UX (no muxer).
 */
export function isCombinedDownloadActionable(audioState: SocialAudioState): boolean {
  return audioState === 'INCLUDED' || audioState === 'UNKNOWN';
}

export function isVideoOnlyUnsupportedForCombinedUx(
  audioState: SocialAudioState,
): boolean {
  return audioState === 'VIDEO_ONLY';
}
