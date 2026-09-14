import {
  recentSearchRepository,
  type RecentSearchRepository,
} from '@/storage/repositories';
import type {
  CreateRecentSearchInput,
  ListRecentSearchesOptions,
  PaginatedResult,
  RecentSearchEntry,
} from '@/storage/types';
import { toStorageError } from '@/storage/types';

export class RecentSearchService {
  constructor(
    private readonly recentSearchRepo: RecentSearchRepository = recentSearchRepository,
  ) {}

  async record(input: CreateRecentSearchInput): Promise<RecentSearchEntry> {
    try {
      return await this.recentSearchRepo.create(input);
    } catch (error) {
      throw toStorageError(error, 'Failed to record recent search');
    }
  }

  async getById(id: string): Promise<RecentSearchEntry | null> {
    return this.recentSearchRepo.findById(id);
  }

  async list(
    options?: ListRecentSearchesOptions,
  ): Promise<PaginatedResult<RecentSearchEntry>> {
    return this.recentSearchRepo.list(options);
  }

  async search(
    query: string,
    options?: Omit<ListRecentSearchesOptions, 'query'>,
  ): Promise<PaginatedResult<RecentSearchEntry>> {
    return this.recentSearchRepo.search(query, options);
  }

  async remove(id: string): Promise<boolean> {
    return this.recentSearchRepo.delete(id);
  }

  async clear(): Promise<number> {
    return this.recentSearchRepo.clear();
  }
}

export const recentSearchService = new RecentSearchService();
