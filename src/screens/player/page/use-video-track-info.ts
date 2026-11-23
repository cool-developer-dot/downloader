import { useEventListener } from 'expo';
import type { VideoPlayer, VideoTrack } from 'expo-video';
import { useState } from 'react';

export type VideoTrackInfo = {
  /** The playing track's size in pixels, when known. */
  width: number | null;
  height: number | null;
  /** Frames per second, when the track says (frame by frame falls back to 30). */
  frameRate: number | null;
  /** P2 #721, for the info overlay: the track's type (`video/avc`), bit rates (bits / s) and dynamic range. */
  mimeType: string | null;
  averageBitrate: number | null;
  peakBitrate: number | null;
  videoRange: string | null;
};

const NO_TRACK: VideoTrackInfo = {
  width: null,
  height: null,
  frameRate: null,
  mimeType: null,
  averageBitrate: null,
  peakBitrate: null,
  videoRange: null,
};

function fromTrack(track: VideoTrack | null | undefined): VideoTrackInfo {
  if (!track) {
    return NO_TRACK;
  }
  return {
    width: track.size?.width ?? null,
    height: track.size?.height ?? null,
    frameRate: track.frameRate ?? null,
    mimeType: track.mimeType ?? null,
    averageBitrate: track.averageBitrate ?? null,
    peakBitrate: track.peakBitrate ?? null,
    videoRange: track.videoRange ?? null,
  };
}

function read(player: VideoPlayer): VideoTrackInfo {
  try {
    return fromTrack(player.videoTrack);
  } catch {
    // A released player has no track.
    return NO_TRACK;
  }
}

/** The playing video track's size, frame rate, type and bit rate, kept current as the player switches tracks. */
export function useVideoTrackInfo(player: VideoPlayer): VideoTrackInfo {
  const [info, setInfo] = useState<VideoTrackInfo>(() => read(player));
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    setInfo(fromTrack(videoTrack));
  });
  return info;
}

/** "1080p": the shorter side of the picture (a portrait 1080 × 1920 video is 1080p too); null when unknown. */
export function qualityLabel(width: number | null, height: number | null): string | null {
  if (width == null || height == null || width <= 0 || height <= 0) {
    return null;
  }
  return `${Math.min(width, height)}p`;
}
