/**
 * Thin controller boundary around expo-video VideoPlayer.
 * UI must not call engine methods directly.
 */

import type { VideoPlayer } from 'expo-video';

import { clampSeekTarget, seekByDelta } from './seek';
import type { PlayerController } from './types';

export type PlayerEngineAdapter = {
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setCurrentTime: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  release: () => void;
};

export function adaptVideoPlayer(player: VideoPlayer): PlayerEngineAdapter {
  return {
    play: () => {
      player.play();
    },
    pause: () => {
      player.pause();
    },
    getCurrentTime: () => {
      const value = player.currentTime;
      return Number.isFinite(value) ? value : 0;
    },
    getDuration: () => {
      const value = player.duration;
      return Number.isFinite(value) && value > 0 ? value : 0;
    },
    setCurrentTime: (seconds: number) => {
      player.currentTime = seconds;
    },
    seekBy: (deltaSeconds: number) => {
      player.seekBy(deltaSeconds);
    },
    setPlaybackRate: (rate: number) => {
      player.playbackRate = rate;
    },
    setVolume: (volume: number) => {
      player.volume = volume;
    },
    setMuted: (muted: boolean) => {
      player.muted = muted;
    },
    release: () => {
      try {
        player.pause();
      } catch {
        // ignore
      }
      try {
        player.release();
      } catch {
        // ignore
      }
    },
  };
}

export function createPlayerController(
  engine: PlayerEngineAdapter | null,
  options?: {
    /** When true, dispose is a no-op (useVideoPlayer owns lifecycle). */
    externalLifecycle?: boolean;
  },
): PlayerController {
  let disposed = false;
  const externalLifecycle = options?.externalLifecycle === true;

  const guard = <T>(fn: () => T): T | void => {
    if (disposed || !engine) {
      return;
    }
    return fn();
  };

  return {
    play: () => {
      guard(() => engine!.play());
    },
    pause: () => {
      guard(() => engine!.pause());
    },
    seekTo: (seconds: number) => {
      guard(() => {
        const duration = engine!.getDuration();
        const durationOrNull = duration > 0 ? duration : null;
        const clamped = clampSeekTarget(seconds, durationOrNull);
        if (clamped == null) {
          return;
        }
        engine!.setCurrentTime(clamped);
      });
    },
    seekBy: (deltaSeconds: number) => {
      guard(() => {
        const duration = engine!.getDuration();
        const durationOrNull = duration > 0 ? duration : null;
        const current = engine!.getCurrentTime();
        const clamped = seekByDelta(current, deltaSeconds, durationOrNull);
        if (clamped == null) {
          return;
        }
        // Prefer absolute seek for clamp correctness at boundaries.
        engine!.setCurrentTime(clamped);
      });
    },
    setPlaybackRate: (rate: number) => {
      guard(() => {
        if (!Number.isFinite(rate) || rate <= 0) {
          return;
        }
        engine!.setPlaybackRate(rate);
      });
    },
    setVolume: (volume: number) => {
      guard(() => {
        if (!Number.isFinite(volume)) {
          return;
        }
        engine!.setVolume(Math.max(0, Math.min(1, volume)));
      });
    },
    setMuted: (muted: boolean) => {
      guard(() => engine!.setMuted(muted));
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (!externalLifecycle && engine) {
        engine.release();
      } else if (engine) {
        try {
          engine.pause();
        } catch {
          // ignore
        }
      }
    },
  };
}
