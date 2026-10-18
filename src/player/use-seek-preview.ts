/**
 * Seek preview frames for the scrubber (F14): the frame at the dragged position, from the player's own source. On for
 * files on the device (library, device videos, files opened from other apps) once a video frame has been shown; never
 * for online streams (F17) or audio. The cache lives while this player shows this media.
 */

import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isStreamMediaId } from './remote-stream';
import { createSeekPreviewLoader, SEEK_PREVIEW_MAX_WIDTH_PX, type SeekPreviewLoader } from './seek-preview';

/** Frames are freed a moment after they leave the cache, so an Image still drawing one never sees it gone. */
const RELEASE_DELAY_MS = 1_000;

function releaseLater(frame: VideoThumbnail): void {
  setTimeout(() => {
    try {
      frame.release();
    } catch {
      // Already released with its player.
    }
  }, RELEASE_DELAY_MS);
}

export function seekPreviewEnabled(input: { mediaId: string | null; hasVideoFrame: boolean }): boolean {
  return Boolean(input.mediaId) && !isStreamMediaId(input.mediaId) && input.hasVideoFrame;
}

export type SeekPreview = {
  /** The frame for the dragged position (null while not scrubbing, before one arrives, or when off). */
  frame: VideoThumbnail | null;
  /** A drag starts: the previous drag's frame is not shown at the new position. */
  beginDrag: () => void;
};

export function useSeekPreview(
  player: VideoPlayer,
  options: { mediaId: string | null; hasVideoFrame: boolean; scrubSeconds: number | null },
): SeekPreview {
  const enabled = seekPreviewEnabled(options);
  const loaderRef = useRef<SeekPreviewLoader | null>(null);
  const [frame, setFrame] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const loader = createSeekPreviewLoader<VideoThumbnail>({
      generate: async (seconds) => {
        const [thumbnail] = await player.generateThumbnailsAsync(seconds, { maxWidth: SEEK_PREVIEW_MAX_WIDTH_PX });
        if (!thumbnail) {
          throw new Error('no_frame');
        }
        return thumbnail;
      },
      onFrame: (_bucket, next) => setFrame(next),
      release: releaseLater,
    });
    loaderRef.current = loader;
    return () => {
      // Closing the player (or another media) drops every frame.
      loader.dispose();
      loaderRef.current = null;
      setFrame(null);
    };
  }, [enabled, options.mediaId, player]);

  useEffect(() => {
    if (options.scrubSeconds == null) {
      return;
    }
    loaderRef.current?.request(options.scrubSeconds);
  }, [options.scrubSeconds]);

  // A new drag shows its own frames — from the cache at once, else as they come; never the last drag's frame.
  const beginDrag = useCallback(() => setFrame(null), []);

  return { frame: enabled && options.scrubSeconds != null ? frame : null, beginDrag };
}
