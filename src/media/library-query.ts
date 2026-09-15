import type { LibraryQuery, LibrarySort, SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

import { isSiteId } from './sites.ts';

/** `recent` lists items from saved playback instead of a native library query. */
export type LibraryScope = 'all' | 'favorites' | 'recent';

export interface LibraryFilters {
  search: string;
  scope: LibraryScope;
  site: SiteId | null;
  sort: LibrarySort;
}

/** Library order the player follows for next/previous. */
export type LibraryOrder = Pick<LibraryQuery, 'search' | 'site' | 'favoritesOnly' | 'sort'>;

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  search: '',
  scope: 'all',
  site: null,
  sort: 'newest',
};

export const LIBRARY_SORTS: readonly LibrarySort[] = ['newest', 'oldest', 'title', 'largest', 'longest'];

const MAX_SEARCH_LENGTH = 100;

export function normalizeSearch(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH);
}

/** Native query for the current filters. Unset fields are omitted so equal filters build equal queries. */
export function buildLibraryQuery(filters: LibraryFilters): LibraryOrder {
  const query: LibraryOrder = { sort: filters.sort };
  const search = normalizeSearch(filters.search);
  if (search) {
    query.search = search;
  }
  if (filters.site) {
    query.site = filters.site;
  }
  if (filters.scope === 'favorites') {
    query.favoritesOnly = true;
  }
  return query;
}

/** Stable identity for a query, used to refetch only when the query really changes. */
export function libraryQueryKey(query: LibraryOrder): string {
  return JSON.stringify([query.search ?? '', query.site ?? '', query.favoritesOnly === true, query.sort ?? 'newest']);
}

export function libraryQueryFromKey(key: string): LibraryOrder {
  const [search, site, favoritesOnly, sort] = JSON.parse(key) as [string, string, boolean, LibrarySort];
  return buildLibraryQuery({
    search,
    site: isSiteId(site) ? site : null,
    scope: favoritesOnly ? 'favorites' : 'all',
    sort: LIBRARY_SORTS.includes(sort) ? sort : 'newest',
  });
}

/** Scope requested through a route param, e.g. `/library?scope=favorites`. */
export function scopeFromParam(value: string | string[] | undefined): LibraryScope | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'all' || raw === 'favorites' || raw === 'recent' ? raw : null;
}

export function hasNarrowingFilters(filters: LibraryFilters): boolean {
  return normalizeSearch(filters.search) !== '' || filters.site !== null || filters.scope !== 'all';
}

/** Client-side title match for lists that do not come from a native query. */
export function titleMatches(title: string, search: string): boolean {
  const needle = normalizeSearch(search).toLocaleLowerCase();
  return needle === '' || title.toLocaleLowerCase().includes(needle);
}
