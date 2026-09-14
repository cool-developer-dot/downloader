import {
  historyRepository,
  recentUrlRepository,
  type HistoryRepository,
  type RecentUrlRepository,
} from '@/storage/repositories';
import type {
  BrowserHistoryEntry,
  CreateHistoryInput,
  ListHistoryOptions,
  PaginatedResult,
  RecentUrlEntry,
  UpdateHistoryInput,
} from '@/storage/types';
import { toStorageError } from '@/storage/types';

export class HistoryService {
  private recordInFlight = new Map<string, Promise<BrowserHistoryEntry>>();

  constructor(
    private readonly historyRepo: HistoryRepository = historyRepository,
    private readonly recentUrlRepo: RecentUrlRepository = recentUrlRepository,
  ) {}

  async recordVisit(input: CreateHistoryInput): Promise<BrowserHistoryEntry> {
    const urlKey = input.url.trim().toLowerCase();
    const existing = this.recordInFlight.get(urlKey);

    if (existing) {
      return existing;
    }

    const task = this.performRecordVisit(input).finally(() => {
      this.recordInFlight.delete(urlKey);
    });

    this.recordInFlight.set(urlKey, task);
    return task;
  }

  private async performRecordVisit(
    input: CreateHistoryInput,
  ): Promise<BrowserHistoryEntry> {
    try {
      const entry = await this.historyRepo.create(input);

      await this.recentUrlRepo.upsert({
        url: entry.url,
        title: entry.title,
        hostname: entry.hostname,
        accessedAt: entry.visitedAt,
      });

      return entry;
    } catch (error) {
      throw toStorageError(error, 'Failed to record browser visit');
    }
  }

  async recordVisits(inputs: CreateHistoryInput[]): Promise<BrowserHistoryEntry[]> {
    const created: BrowserHistoryEntry[] = [];

    for (const input of inputs) {
      created.push(await this.recordVisit(input));
    }

    return created;
  }

  async getById(id: string): Promise<BrowserHistoryEntry | null> {
    return this.historyRepo.findById(id);
  }

  async list(options?: ListHistoryOptions): Promise<PaginatedResult<BrowserHistoryEntry>> {
    return this.historyRepo.list(options);
  }

  async search(
    query: string,
    options?: Omit<ListHistoryOptions, 'query'>,
  ): Promise<PaginatedResult<BrowserHistoryEntry>> {
    return this.historyRepo.search(query, options);
  }

  async update(id: string, input: UpdateHistoryInput): Promise<BrowserHistoryEntry> {
    return this.historyRepo.update(id, input);
  }

  async remove(id: string): Promise<boolean> {
    return this.historyRepo.delete(id);
  }

  async removeMany(ids: string[]): Promise<number> {
    return this.historyRepo.deleteMany(ids);
  }

  async clear(): Promise<number> {
    const deleted = await this.historyRepo.clear();
    await this.recentUrlRepo.clear();
    return deleted;
  }

  async getRecentUrls(limit = 20): Promise<RecentUrlEntry[]> {
    return this.recentUrlRepo.list(limit);
  }

  async getRecentFromHistory(limit = 20): Promise<BrowserHistoryEntry[]> {
    return this.historyRepo.getRecentUrls(limit);
  }

  async getFrequentlyVisited(
    limit = 20,
  ): Promise<(BrowserHistoryEntry & { visitCount: number })[]> {
    return this.historyRepo.getFrequentlyVisited(limit);
  }
}

export const historyService = new HistoryService();
