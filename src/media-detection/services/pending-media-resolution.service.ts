import type { PlatformPageKind } from '../platform/types';
import { isSameDocumentUrl } from '../utils';

export type PendingResolutionStatus =
  | 'resolving_redirect'
  | 'loading_page'
  | 'waiting_media'
  | 'waiting_playback'
  | 'verified'
  | 'failed'
  | 'timeout';

export type PendingMediaResolution = {
  id: string;
  originalUrl: string;
  canonicalUrl: string | null;
  platform: PlatformPageKind;
  startedAt: number;
  status: PendingResolutionStatus;
  failureReason: string | null;
};

type Listener = () => void;

let active: PendingMediaResolution | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

function createId(): string {
  return `pmr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const pendingMediaResolutionService = {
  get(): PendingMediaResolution | null {
    return active;
  },

  isActive(): boolean {
    return active != null && active.status !== 'verified' && active.status !== 'failed';
  },

  start(input: {
    originalUrl: string;
    canonicalUrl: string;
    platform: PlatformPageKind;
  }): PendingMediaResolution {
    active = {
      id: createId(),
      originalUrl: input.originalUrl.trim(),
      canonicalUrl: input.canonicalUrl.trim(),
      platform: input.platform,
      startedAt: Date.now(),
      status: 'loading_page',
      failureReason: null,
    };
    emit();
    return active;
  },

  update(
    patch: Partial<
      Pick<PendingMediaResolution, 'status' | 'canonicalUrl' | 'failureReason'>
    >,
  ): PendingMediaResolution | null {
    if (!active) {
      return null;
    }
    active = { ...active, ...patch };
    emit();
    return active;
  },

  markVerified(): void {
    if (!active) {
      return;
    }
    active = { ...active, status: 'verified', failureReason: null };
    emit();
  },

  fail(reason: string): void {
    if (!active) {
      return;
    }
    active = { ...active, status: 'failed', failureReason: reason };
    emit();
  },

  timeout(): void {
    if (!active) {
      return;
    }
    active = {
      ...active,
      status: 'timeout',
      failureReason: 'no_media_detected',
    };
    emit();
  },

  clear(): void {
    active = null;
    emit();
  },

  matchesPageUrl(pageUrl: string | null | undefined): boolean {
    if (!active?.canonicalUrl || !pageUrl) {
      return false;
    }
    return isSameDocumentUrl(active.canonicalUrl, pageUrl);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
} as const;
