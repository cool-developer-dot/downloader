import { useEffect } from 'react';
import { create } from 'zustand';

import { getBooleanFlag, setBooleanFlag } from '@/storage/mmkv/flags';

import {
  INITIAL_TOUR_STATE,
  linkDeferral,
  reduceTour,
  TOUR_SEEN_KEY,
  type LinkDeferralEvent,
  type LinkDeferralState,
  type TourAction,
  type TourState,
} from './tour-policy';

type TourStore = TourState & {
  /** The MMKV "seen" flag, read once and kept in sync. */
  seen: boolean;
  /** Sheets, menus and dialogs currently open (each is a native window the tour must never sit under). */
  openOverlays: number;
  linkDeferral: LinkDeferralState;
  /** The tour is drawn right now (TalkBack hides the app underneath while it is). */
  presented: boolean;
  dispatch: (action: TourAction) => void;
  noteLink: (event: LinkDeferralEvent) => void;
  setPresented: (presented: boolean) => void;
  overlayOpened: () => void;
  overlayClosed: () => void;
};

export const useTourStore = create<TourStore>((set, get) => ({
  ...INITIAL_TOUR_STATE,
  seen: getBooleanFlag(TOUR_SEEN_KEY, false),
  openOverlays: 0,
  linkDeferral: 'none',
  presented: false,
  dispatch: (action) => {
    const { state, ended } = reduceTour(pickTourState(get()), action);
    if (ended) {
      setBooleanFlag(TOUR_SEEN_KEY, true);
    }
    set({ ...state, ...(ended ? { seen: true } : null) });
  },
  noteLink: (event) => {
    const next = linkDeferral(get().linkDeferral, event);
    if (next !== get().linkDeferral) {
      set({ linkDeferral: next });
    }
  },
  setPresented: (presented) => {
    if (presented !== get().presented) {
      set({ presented });
    }
  },
  overlayOpened: () => set((s) => ({ openOverlays: s.openOverlays + 1 })),
  overlayClosed: () => set((s) => ({ openOverlays: Math.max(0, s.openOverlays - 1) })),
}));

function pickTourState(store: TourStore): TourState {
  return {
    status: store.status,
    stepIndex: store.stepIndex,
    direction: store.direction,
    replayRequested: store.replayRequested,
  };
}

/** "Show the tour again": the tour starts the next time the Browser is idle (the caller opens the Browser). */
export function requestTourReplay(): void {
  useTourStore.getState().dispatch({ type: 'request_replay' });
}

/** A link was shared to / opened with VidoraX: the tour waits (or, if showing, steps aside) for a calmer moment. */
export function noteTourLinkOpened(): void {
  const store = useTourStore.getState();
  store.noteLink('link_opened');
  store.dispatch({ type: 'suspend' });
}

/** Keeps the tour from starting while a sheet, menu or dialog is open. */
export function useTourBlocker(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    useTourStore.getState().overlayOpened();
    return () => {
      useTourStore.getState().overlayClosed();
    };
  }, [active]);
}
