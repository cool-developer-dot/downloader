import type { PlayerStore } from './types';

export const selectCurrentVideo = (state: PlayerStore) => state.currentVideo;
export const selectPlaybackPosition = (state: PlayerStore) => state.playbackPosition;
export const selectPlaybackRate = (state: PlayerStore) => state.playbackRate;
export const selectFullscreen = (state: PlayerStore) => state.fullscreen;
