import type { PlayerState } from './types';

export const initialPlayerState: PlayerState = {
  currentVideo: null,
  playbackPosition: 0,
  playbackRate: 1,
  fullscreen: false,
};
