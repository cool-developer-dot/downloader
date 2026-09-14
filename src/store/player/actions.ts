import type { StoreApi } from 'zustand';

import { initialPlayerState } from './state';
import type { PlayerActions, PlayerStore } from './types';

export function createPlayerActions(
  set: StoreApi<PlayerStore>['setState'],
): PlayerActions {
  return {
    play: (video) => {
      set({ currentVideo: video, playbackPosition: 0 });
    },
    pause: () => {
      set({ playbackRate: 0 });
    },
    seek: (position) => {
      set({ playbackPosition: position });
    },
    reset: () => {
      set(initialPlayerState);
    },
  };
}
