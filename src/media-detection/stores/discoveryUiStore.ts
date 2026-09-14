/**
 * Lightweight discovery presentation state — separate from detection SSoT.
 * Does not own detected media; only UI chrome (dismiss / expand / focus).
 */

import { createStore } from '@/store/shared/create-store';

export type DiscoveryUiState = {
  /** Media ids dismissed for the current page session. */
  dismissedIds: Record<string, true>;
  /**
   * Ids present when the user last dismissed the card.
   * Card stays hidden for these until navigation reset or a brand-new id appears.
   */
  sessionFingerprint: string[];
  /** True after ✕ / swipe dismiss until nav change or newly detected media. */
  sessionDismissed: boolean;
  /** Expanded detail view for the focused card. */
  expanded: boolean;
  /** Focused media id when multiple candidates exist. */
  focusedMediaId: string | null;
  /** Navigation URL when dismissals were last reset. */
  sessionPageUrl: string | null;
};

export type DiscoveryUiActions = {
  dismiss: (mediaId: string) => void;
  /** Dismiss the whole discovery session (all known ids) — used by ✕ / swipe. */
  dismissSession: (mediaIds: string[]) => void;
  setExpanded: (expanded: boolean) => void;
  setFocusedMediaId: (id: string | null) => void;
  resetForNavigation: (pageUrl: string | null) => void;
  reset: () => void;
};

export type DiscoveryUiStore = DiscoveryUiState & DiscoveryUiActions;

const initialDiscoveryUiState: DiscoveryUiState = {
  dismissedIds: {},
  sessionFingerprint: [],
  sessionDismissed: false,
  expanded: false,
  focusedMediaId: null,
  sessionPageUrl: null,
};

export const useDiscoveryUiStore = createStore<DiscoveryUiStore>((set, get) => ({
  ...initialDiscoveryUiState,

  dismiss: (mediaId) => {
    set({
      dismissedIds: { ...get().dismissedIds, [mediaId]: true },
      expanded: false,
      focusedMediaId:
        get().focusedMediaId === mediaId ? null : get().focusedMediaId,
    });
  },

  dismissSession: (mediaIds) => {
    const unique = Array.from(new Set(mediaIds.filter(Boolean)));
    const dismissedIds = { ...get().dismissedIds };
    for (const id of unique) {
      dismissedIds[id] = true;
    }
    set({
      dismissedIds,
      sessionFingerprint: unique,
      sessionDismissed: true,
      expanded: false,
      focusedMediaId: null,
    });
  },

  setExpanded: (expanded) => {
    set({ expanded });
  },

  setFocusedMediaId: (id) => {
    set({ focusedMediaId: id, expanded: false });
  },

  resetForNavigation: (pageUrl) => {
    if (pageUrl === get().sessionPageUrl) {
      return;
    }
    set({
      dismissedIds: {},
      sessionFingerprint: [],
      sessionDismissed: false,
      expanded: false,
      focusedMediaId: null,
      sessionPageUrl: pageUrl,
    });
  },

  reset: () => {
    set({ ...initialDiscoveryUiState });
  },
}));

export const selectDismissedIds = (s: DiscoveryUiStore) => s.dismissedIds;
export const selectDiscoveryExpanded = (s: DiscoveryUiStore) => s.expanded;
export const selectFocusedMediaId = (s: DiscoveryUiStore) => s.focusedMediaId;
export const selectSessionDismissed = (s: DiscoveryUiStore) => s.sessionDismissed;
