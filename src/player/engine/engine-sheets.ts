/**
 * Which of Faran's Player sheets is open (one at a time). A store, so any part of the Player screen opens one — the
 * Audio chip (P17), an options-sheet row, the speed button — without passing handlers around.
 */

import { createStore } from '@/store/shared/create-store';

export type EngineSheet = 'streamQuality' | 'headsetKeys' | 'audio';

const useEngineSheetStore = createStore<{ open: EngineSheet | null }>()(() => ({ open: null }));

export function openEngineSheet(sheet: EngineSheet): void {
  useEngineSheetStore.setState({ open: sheet });
}

export function closeEngineSheet(): void {
  useEngineSheetStore.setState({ open: null });
}

export function useOpenEngineSheet(): EngineSheet | null {
  return useEngineSheetStore((state) => state.open);
}

export function getOpenEngineSheet(): EngineSheet | null {
  return useEngineSheetStore.getState().open;
}
