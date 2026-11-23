/**
 * Playback event contract (Day 2+).
 * Day 3 Phase 1 coordinator subscribes once for durable persistence.
 * Do not add a second player-event system.
 */

import { isMovedToPrivate } from '../privacy/private-media-guard';

export type PlaybackContractEvent =
  | {
      type: 'playbackStarted';
      mediaId: string;
      at: number;
    }
  | {
      type: 'positionChanged';
      mediaId: string;
      positionSeconds: number;
      durationSeconds: number | null;
      at: number;
    }
  | {
      type: 'paused';
      mediaId: string;
      positionSeconds: number;
      at: number;
    }
  | {
      type: 'completed';
      mediaId: string;
      at: number;
    }
  | {
      type: 'playerExited';
      mediaId: string;
      positionSeconds: number;
      at: number;
    };

export type PlaybackEventListener = (event: PlaybackContractEvent) => void;

const listeners = new Set<PlaybackEventListener>();

/** Subscribers (exactly one production binder: playback persistence coordinator). */
export function subscribePlaybackEvents(
  listener: PlaybackEventListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitPlaybackEvent(event: PlaybackContractEvent): void {
  // P11 #686: a video moved to Private in this run records nothing more — no resume point, no Watch history or
  // Continue watching entry, no play count (both listeners read these events).
  if (isMovedToPrivate(event.mediaId)) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Subscribers must not break playback.
    }
  }
}

/** Test helper — clears subscribers between verification runs. */
export function resetPlaybackEventListeners(): void {
  listeners.clear();
}
