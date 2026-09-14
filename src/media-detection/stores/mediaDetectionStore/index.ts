import { createStore } from '@/store/shared/create-store';

import type { MediaDetectionStore } from '../../types';
import { createMediaDetectionActions } from './actions';
import { initialMediaDetectionState } from './state';

export const useMediaDetectionStore = createStore<MediaDetectionStore>(
  (set, get) => ({
    ...initialMediaDetectionState,
    ...createMediaDetectionActions(set, get),
  }),
);

export * from './selectors';
export { initialMediaDetectionState, initialDetectionStatistics } from './state';
