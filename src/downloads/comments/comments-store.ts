import { Directory, File, Paths } from 'expo-file-system';
import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { MAX_SAVED_COMMENTS, parseJsonLdComments, parseRedditComments, redditCommentsJsonUrl, type SavedComments } from './comments-core';

/**
 * #380 Comments download: a video's public comments kept beside it on the phone — `<documents>/comments/<id>.json`,
 * read from its source page without cookies. Deleted with the download.
 */

const DIRECTORY = 'comments';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function fileOf(downloadId: string): File | null {
  return SAFE_ID.test(downloadId) ? new File(Paths.document, DIRECTORY, `${downloadId}.json`) : null;
}

export function readSavedComments(downloadId: string): SavedComments | null {
  try {
    const file = fileOf(downloadId);
    if (!file?.exists) return null;
    const value = JSON.parse(file.textSync()) as SavedComments;
    return value && Array.isArray(value.comments) ? value : null;
  } catch {
    return null;
  }
}

export function deleteSavedComments(downloadId: string): void {
  try {
    const file = fileOf(downloadId);
    if (file?.exists) file.delete();
  } catch {
    // Cleanup never throws into the delete flow.
  }
}

export type FetchCommentsOutcome = { status: 'saved'; saved: SavedComments } | { status: 'none' | 'failed' | 'unavailable' };

async function fetchBody(url: string): Promise<string | 'media' | null> {
  const result = await getVidoraMedia()
    .fetchPage({ url, useSessionCookies: false, commitCookies: false, timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 })
    .catch(() => null);
  // The source is the video file itself: there is no page, so no comments.
  if (result?.kind === 'media') return 'media';
  return result?.kind === 'document' && result.status >= 200 && result.status < 300 ? result.body : null;
}

/** A source that is a video file (no page around it): nothing to read comments from. */
export function isDirectMediaSource(url: string): boolean {
  try {
    return /\.(?:mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd|avi|wmv|3gp|mpg|mpeg)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Reads [sourceUrl]'s public comments and keeps them for [downloadId]; `none` when the page shares none. */
export async function fetchAndSaveComments(downloadId: string, sourceUrl: string): Promise<FetchCommentsOutcome> {
  const file = fileOf(downloadId);
  if (!file || !isVidoraMediaAvailable()) return { status: 'unavailable' };
  const reddit = redditCommentsJsonUrl(sourceUrl);
  const body = await fetchBody(reddit ?? sourceUrl);
  if (body === 'media') return { status: 'none' };
  if (body === null) return { status: 'failed' };
  let comments;
  try {
    comments = reddit ? parseRedditComments(JSON.parse(body)) : parseJsonLdComments(body);
  } catch {
    return { status: 'failed' };
  }
  if (comments.length === 0) return { status: 'none' };
  const saved: SavedComments = { sourceUrl, savedAt: new Date().toISOString(), comments: comments.slice(0, MAX_SAVED_COMMENTS) };
  try {
    const dir = new Directory(Paths.document, DIRECTORY);
    if (!dir.exists) dir.create({ intermediates: true });
    if (!file.exists) file.create();
    file.write(JSON.stringify(saved));
  } catch {
    return { status: 'failed' };
  }
  return { status: 'saved', saved };
}
