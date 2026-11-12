/**
 * Files other apps open in VidoraX ("Open with VidoraX"). The player knows such a file only by an opaque token from
 * the VidoraMedia module (never its URI): its media id is `external:<token>`. The token is a hash of the file's URI,
 * so the same file opened again continues where it stopped; it has no library row and no Watch history entry.
 * Pure — no native imports.
 */

import type { ImportIncomingResult, IncomingMedia } from '@modules/vidorax-media/src/VidoraMedia.types';

const ID_PREFIX = 'external:';
const TOKEN = /^[0-9a-f]{32}$/;

export function isIncomingMediaToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** Media id the player route uses for an incoming file; distinct from download and device ids. */
export function externalMediaId(token: string): string {
  if (!isIncomingMediaToken(token)) {
    throw new Error('invalid_incoming_token');
  }
  return `${ID_PREFIX}${token}`;
}

export function isExternalMediaId(mediaId: string | null | undefined): boolean {
  return typeof mediaId === 'string' && mediaId.startsWith(ID_PREFIX);
}

/** The token of an `external:` media id, or null when it is not a well-formed one. */
export function externalTokenOf(mediaId: string | null | undefined): string | null {
  if (!isExternalMediaId(mediaId)) {
    return null;
  }
  const token = (mediaId as string).slice(ID_PREFIX.length);
  return isIncomingMediaToken(token) ? token : null;
}

/** A local file link (`content:` / `file:`) — the VidoraMedia module's, never a route. */
export function isIncomingFileLink(url: string | null | undefined): boolean {
  const trimmed = url?.trim().toLowerCase();
  return Boolean(trimmed && (trimmed.startsWith('content:') || trimmed.startsWith('file:')));
}

/** Incoming files by media id, as they arrived (the title before the source resolves). */
const known = new Map<string, IncomingMedia>();

export function rememberIncomingMedia(media: IncomingMedia): string | null {
  if (!isIncomingMediaToken(media?.token)) {
    return null;
  }
  const id = externalMediaId(media.token);
  known.set(id, media);
  return id;
}

export function knownIncomingMedia(mediaId: string): IncomingMedia | null {
  return known.get(mediaId) ?? null;
}

export function forgetIncomingMediaForTests(): void {
  known.clear();
}

/**
 * The file waiting to be opened. It opens once the app shell is up (after the splash) and App Lock, when enabled, is
 * unlocked — nothing plays behind the PIN screen. A newer file replaces one that has not opened yet.
 */
export type IncomingOpenGate = {
  shellReady: boolean;
  appLockEnabled: boolean;
  unlocked: boolean;
};

/**
 * Whether the app shell is what the user sees: not the branded splash, the first-launch pages, or the root path while
 * it still redirects. The splash ends by replacing the top route with the Browser, so a Player opened before that would
 * be replaced (its session left in the mini player).
 */
export function isAppShellRoute(pathname: string | null | undefined): boolean {
  const path = (pathname ?? '').trim();
  if (!path || path === '/') {
    return false;
  }
  return !(path === '/splash' || path === '/onboarding' || path.startsWith('/onboarding/'));
}

export function canOpenIncomingMedia(gate: IncomingOpenGate): boolean {
  return gate.shellReady && (!gate.appLockEnabled || gate.unlocked);
}

export function createIncomingMediaQueue() {
  let pending: IncomingMedia | null = null;
  const listeners = new Set<() => void>();
  return {
    capture(media: IncomingMedia | null | undefined): boolean {
      if (!media || !isIncomingMediaToken(media.token)) {
        return false;
      }
      pending = media;
      listeners.forEach((listener) => {
        try {
          listener();
        } catch {
          // A host failing must not lose the file.
        }
      });
      return true;
    },
    /** The pending file's media id when it may open now (it is then no longer pending), else null. */
    takeIfAllowed(gate: IncomingOpenGate): string | null {
      if (!pending || !canOpenIncomingMedia(gate)) {
        return null;
      }
      const id = rememberIncomingMedia(pending);
      pending = null;
      return id;
    },
    hasPending: () => pending != null,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SaveIncomingOutcome =
  | { kind: 'saved'; libraryItemId: string }
  | { kind: 'duplicate'; libraryItemId: string | null }
  | { kind: 'no_space' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/** Maps the module's result and rejection codes to what the Player tells the user. */
export function saveOutcomeFrom(result: ImportIncomingResult | null, errorCode: string | null): SaveIncomingOutcome {
  if (result?.status === 'imported') {
    return { kind: 'saved', libraryItemId: result.item.id };
  }
  if (result?.status === 'duplicate') {
    return { kind: 'duplicate', libraryItemId: result.libraryItemId };
  }
  switch (errorCode) {
    case 'ERR_NO_SPACE':
      return { kind: 'no_space' };
    case 'ERR_NOT_FOUND':
      return { kind: 'unavailable' };
    default:
      return { kind: 'failed' };
  }
}
