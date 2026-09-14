import {
  DEFAULT_LIBRARY_FILTER,
  DEFAULT_LIBRARY_SORT,
} from '@/library/constants';
import { readPersistedLibraryViewMode } from '@/library/view-mode';

import type { LibraryState } from './types';

export const initialLibraryState: LibraryState = {
  searchQuery: '',
  filter: DEFAULT_LIBRARY_FILTER,
  sort: DEFAULT_LIBRARY_SORT,
  quality: null,
  folderId: null,
  viewMode: readPersistedLibraryViewMode(),
  availabilityById: {},
  sourceRevision: 0,
  lastReconciledAt: null,
  loading: false,
  refreshing: false,
  error: null,
  initialized: false,
};
