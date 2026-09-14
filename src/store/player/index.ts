import { createStore } from '@/store/shared/create-store';

import { createPlayerActions } from './actions';
import { initialPlayerState } from './state';
import type { PlayerStore } from './types';

export const usePlayerStore = createStore<PlayerStore>((set) => ({
  ...initialPlayerState,
  ...createPlayerActions(set),
}));

export * from './selectors';
export type { PlayerActions, PlayerState, PlayerStore, VideoItem } from './types';
