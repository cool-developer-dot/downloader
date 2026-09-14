import { createStore } from '@/store/shared/create-store';

import { createHistoryActions } from './actions';
import { initialHistoryState } from './state';
import type { HistoryStore } from './types';

export const useHistoryStore = createStore<HistoryStore>((set, get) => ({
  ...initialHistoryState,
  ...createHistoryActions(set, get),
}));

export * from './selectors';
export type { HistoryActions, HistoryState, HistoryStore } from './types';
