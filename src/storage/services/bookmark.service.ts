import {
  bookmarkRepository,
  type BookmarkRepository,
} from '@/storage/repositories';
import type {
  BookmarkEntry,
  CreateBookmarkInput,
  ListBookmarksOptions,
  PaginatedResult,
  UpdateBookmarkInput,
} from '@/storage/types';
import { toStorageError } from '@/storage/types';

function buildFaviconUrl(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }
  return `https://${host}/favicon.ico`;
}

export class BookmarkService {
  private toggleInFlight = new Map<
    string,
    Promise<{ bookmarked: boolean; bookmark: BookmarkEntry | null }>
  >();

  constructor(private readonly bookmarkRepo: BookmarkRepository = bookmarkRepository) {}

  async add(input: CreateBookmarkInput): Promise<BookmarkEntry> {
    try {
      let hostname = input.hostname?.trim() || '';
      if (!hostname) {
        try {
          hostname = new URL(input.url).hostname;
        } catch {
          hostname = '';
        }
      }

      return await this.bookmarkRepo.create({
        ...input,
        hostname: hostname || input.hostname,
        faviconUrl:
          input.faviconUrl !== undefined
            ? input.faviconUrl
            : buildFaviconUrl(hostname),
      });
    } catch (error) {
      throw toStorageError(error, 'Failed to add bookmark');
    }
  }

  async getById(id: string): Promise<BookmarkEntry | null> {
    return this.bookmarkRepo.findById(id);
  }

  async getByUrl(url: string): Promise<BookmarkEntry | null> {
    return this.bookmarkRepo.findByUrl(url);
  }

  async isBookmarked(url: string): Promise<boolean> {
    return this.bookmarkRepo.existsByUrl(url);
  }

  async list(options?: ListBookmarksOptions): Promise<PaginatedResult<BookmarkEntry>> {
    return this.bookmarkRepo.list(options);
  }

  async search(
    query: string,
    options?: Omit<ListBookmarksOptions, 'query'>,
  ): Promise<PaginatedResult<BookmarkEntry>> {
    return this.bookmarkRepo.search(query, options);
  }

  async update(id: string, input: UpdateBookmarkInput): Promise<BookmarkEntry> {
    return this.bookmarkRepo.update(id, input);
  }

  async remove(id: string): Promise<boolean> {
    return this.bookmarkRepo.delete(id);
  }

  async removeByUrl(url: string): Promise<boolean> {
    const existing = await this.bookmarkRepo.findByUrl(url);

    if (!existing) {
      return false;
    }

    return this.remove(existing.id);
  }

  async removeMany(ids: string[]): Promise<number> {
    return this.bookmarkRepo.deleteMany(ids);
  }

  async clear(): Promise<number> {
    return this.bookmarkRepo.clear();
  }

  async toggle(input: CreateBookmarkInput): Promise<{
    bookmarked: boolean;
    bookmark: BookmarkEntry | null;
  }> {
    const urlKey = input.url.trim().toLowerCase();
    const existingTask = this.toggleInFlight.get(urlKey);

    if (existingTask) {
      return existingTask;
    }

    const task = this.performToggle(input).finally(() => {
      this.toggleInFlight.delete(urlKey);
    });

    this.toggleInFlight.set(urlKey, task);
    return task;
  }

  private async performToggle(input: CreateBookmarkInput): Promise<{
    bookmarked: boolean;
    bookmark: BookmarkEntry | null;
  }> {
    const existing = await this.bookmarkRepo.findByUrl(input.url);

    if (existing) {
      await this.remove(existing.id);
      return { bookmarked: false, bookmark: null };
    }

    const bookmark = await this.add(input);
    return { bookmarked: true, bookmark };
  }
}

export const bookmarkService = new BookmarkService();
