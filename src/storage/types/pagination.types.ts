export type SortDirection = 'asc' | 'desc';

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface SortInput<TField extends string = string> {
  sortBy?: TField;
  sortDirection?: SortDirection;
}

export interface SearchInput {
  query?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export function normalizePagination(
  input: PaginationInput | undefined,
  defaults: { page: number; pageSize: number; maxPageSize: number },
): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, input?.page ?? defaults.page);
  const pageSize = Math.min(
    defaults.maxPageSize,
    Math.max(1, input?.pageSize ?? defaults.pageSize),
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page * pageSize < total,
  };
}
