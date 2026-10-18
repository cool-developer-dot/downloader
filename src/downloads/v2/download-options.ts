/**
 * Before the download starts (H8): the quality sheet's collapsed "Options". Pure.
 *
 * - Rename Before Download (#296): the name field starts with the File naming template's output (H10) and is cleaned
 *   the same way (`sanitizeFileName`). Only a name the user actually edited replaces the request title.
 * - Ask Where to Save (#155): one of the existing logical library folders; Unfiled (null) is the default. Assigned
 *   with the existing folder-assignment code once the download completes.
 * - Per-item Settings (#480): `saveToGallery`, and `wifiOnly` (kept by the engine per download, native
 *   engine/NetworkChoices). "As in settings" leaves the request without the field, so the app setting decides.
 *
 * Untouched options change nothing: the request reaches the engine exactly as it does without the panel.
 */

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { sanitizeFileName } from './filename-template';

export type GalleryChoice = 'default' | 'on' | 'off';
/** #480: this download's own Wi-Fi only; 'default' follows Download Settings. */
export type WifiChoice = 'default' | 'on' | 'off';

export type DownloadOptionsDraft = {
  /** The offer's source URL the options belong to (`identityUrl ?? url` of the request it produces). */
  identity: string;
  /** The name field's text; used only when `titleEdited`. */
  title: string;
  titleEdited: boolean;
  /** A library folder id; null = Unfiled (the default). */
  folderId: string | null;
  saveToGallery: GalleryChoice;
  /** Older drafts have none: the same as 'default'. */
  wifiOnly?: WifiChoice;
};

export function requestIdentity(request: Pick<EnqueueRequest, 'url' | 'identityUrl'>): string {
  return request.identityUrl ?? request.url;
}

/** The edited name, cleaned; null when it was not edited or nothing usable is left. */
export function editedTitle(draft: Pick<DownloadOptionsDraft, 'title' | 'titleEdited'>): string | null {
  if (!draft.titleEdited) {
    return null;
  }
  const cleaned = sanitizeFileName(draft.title);
  return cleaned || null;
}

/**
 * Pure: the request fields the options change, for a draft that belongs to this request. Empty when nothing was
 * changed or the draft is for another offer.
 */
export function requestOverrides(
  request: Pick<EnqueueRequest, 'url' | 'identityUrl'>,
  draft: DownloadOptionsDraft | null,
): Partial<Pick<EnqueueRequest, 'title' | 'saveToGallery' | 'wifiOnly'>> {
  if (!draft || draft.identity !== requestIdentity(request)) {
    return {};
  }
  const overrides: Partial<Pick<EnqueueRequest, 'title' | 'saveToGallery' | 'wifiOnly'>> = {};
  const title = editedTitle(draft);
  if (title) {
    overrides.title = title;
  }
  if (draft.saveToGallery !== 'default') {
    overrides.saveToGallery = draft.saveToGallery === 'on';
  }
  if (draft.wifiOnly === 'on' || draft.wifiOnly === 'off') {
    overrides.wifiOnly = draft.wifiOnly === 'on';
  }
  return overrides;
}

/** Pure: the draft after `patch` — a new one for a first change, the same values carried otherwise. */
export function nextDraft(
  current: DownloadOptionsDraft | null,
  patch: Partial<DownloadOptionsDraft> & { identity: string },
): DownloadOptionsDraft {
  const base: DownloadOptionsDraft = current ?? {
    identity: patch.identity,
    title: '',
    titleEdited: false,
    folderId: null,
    saveToGallery: 'default',
    wifiOnly: 'default',
  };
  return { ...base, ...patch };
}

/** Pure: whether the options differ from their defaults (the collapsed row says so). */
export function hasChangedOptions(draft: DownloadOptionsDraft | null): boolean {
  return Boolean(
    draft &&
      (editedTitle(draft) ||
        draft.folderId != null ||
        draft.saveToGallery !== 'default' ||
        (draft.wifiOnly ?? 'default') !== 'default'),
  );
}

export type PendingFolders = Record<string, string>;
const MAX_PENDING = 200;

/** Pure: remembers that `downloadId` goes into `folderId` when it completes (Unfiled needs nothing). */
export function rememberFolder(pending: PendingFolders, downloadId: string | null, folderId: string | null): PendingFolders {
  if (!downloadId || folderId == null) {
    return pending;
  }
  const next = { ...pending, [downloadId]: folderId };
  const keys = Object.keys(next);
  if (keys.length > MAX_PENDING) {
    for (const key of keys.slice(0, keys.length - MAX_PENDING)) {
      delete next[key];
    }
  }
  return next;
}

/** Pure: on a state change, the folder to assign now (completed) and the remaining pending map. */
export function folderOnStateChange(
  pending: PendingFolders,
  record: { id: string; state: string },
): { assign: string | null; pending: PendingFolders } {
  const folderId = pending[record.id];
  if (folderId == null) {
    return { assign: null, pending };
  }
  if (record.state === 'completed' || record.state === 'cancelled') {
    const { [record.id]: _done, ...rest } = pending;
    return { assign: record.state === 'completed' ? folderId : null, pending: rest };
  }
  return { assign: null, pending };
}

let draftSource: (() => DownloadOptionsDraft | null) | null = null;

/** The quality sheet's options store registers itself here (`ensureDownloadOptions`); nothing registered = no options. */
export function setDownloadOptionsSource(source: (() => DownloadOptionsDraft | null) | null): void {
  draftSource = source;
}

/** Applies the sheet's options to `request` in place (handoff, right before the engine call). Never throws. */
export function applyDownloadOptions(request: EnqueueRequest): void {
  try {
    Object.assign(request, requestOverrides(request, draftSource?.() ?? null));
  } catch {
    // Options must never stop a download.
  }
}
