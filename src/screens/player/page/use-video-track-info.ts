import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useState } from 'react';

export type VideoTrackInfo = {
  /** The playing track's size in pixels, when known. */
  width: number | null;
  height: number | null;
  /** Frames per second, when the track says (frame by frame falls back to 30). */
  frameRate: number | null;
};

function read(player: VideoPlayer): VideoTrackInfo {
  try {
    const track = player.videoTrack;
    return {
      width: track?.size?.width ?? null,
      height: track?.size?.height ?? null,
      frameRate: track?.frameRate ?? null,
    };
  } catch {
    // A released player has no track.
    return { width: null, height: null, frameRate: null };
  }
}

/** The playing video track's size and frame rate, kept current as the player switches tracks. */
export function useVideoTrackInfo(player: VideoPlayer): VideoTrackInfo {
  const [info, setInfo] = useState<VideoTrackInfo>(() => read(player));
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    setInfo({
      width: videoTrack?.size?.width ?? null,
      height: videoTrack?.size?.height ?? null,
      frameRate: videoTrack?.frameRate ?? null,
    });
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
