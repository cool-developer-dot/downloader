/**
 * Files F9: the search opened with filters already set, from a link (`/files/search?types=archive,apk&sort=size`) — the
 * Storage page's rows and FILTERS chips. Pure. Unknown values are ignored, so a bad link opens a plain search.
 */

import { isFileType } from '@/files/ui/file-types';
import type { FileType } from '@/files/api';

import { OLD_MONTHS, SEARCH_SORTS, type OldMonths, type SearchFilters, type SearchSort } from './files-search';

const MB = 1024 * 1024;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function searchStateFromParams(params: Params): { filters: SearchFilters; sort: SearchSort | null } {
  const filters: SearchFilters = {};
  const types = first(params.types)
    .split(',')
    .map((type) => type.trim())
    .filter((type): type is FileType => isFileType(type));
  if (types.length > 0) filters.types = [...new Set(types)];
  const minMb = Number(first(params.minMb));
  if (Number.isFinite(minMb) && minMb > 0) filters.minBytes = minMb * MB;
  const old = Number(first(params.old));
  if ((OLD_MONTHS as readonly number[]).includes(old)) filters.oldMonths = old as OldMonths;
  const sort = first(params.sort);
  return { filters, sort: (SEARCH_SORTS as readonly string[]).includes(sort) ? (sort as SearchSort) : null };
}
