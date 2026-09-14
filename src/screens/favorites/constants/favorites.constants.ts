export const FAVORITES_COPY = {
  title: 'Favorites',
  searchPlaceholder: 'Search favorites',
  emptyTitle: 'No favorites yet',
  emptyDescription: 'Save downloads you care about from Download Details.',
  emptyAction: 'Open Downloads',
  emptySearchTitle: 'No favorites found',
  emptySearchDescription: 'Try a different title or URL.',
  errorTitle: 'Couldn’t load favorites',
  removeTitle: 'Remove favorite?',
  removeMessage: 'This item will be removed from your favorites.',
  removeConfirm: 'Remove',
  removeCancel: 'Cancel',
  unavailableTitle: 'Download unavailable',
  unavailableDescription:
    'The original download is no longer available. You can remove this favorite.',
  unavailableAction: 'Remove favorite',
  loadingAnnouncement: 'Loading favorites',
  endOfList: 'You’re all caught up',
  toggleFailed: 'Couldn’t update favorite. Try again.',
  openFailed: 'Couldn’t open this favorite.',
} as const;

export const SEARCH_DEBOUNCE_MS = 280;
