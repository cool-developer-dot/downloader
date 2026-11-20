/**
 * #304: an FTP link the user pasted, typed, shared or put in Batch Add — classified by the engine (its size and first
 * bytes must be a video: plan/FtpProbe) and enqueued as `kind: 'ftp'`, with the engine's atomic duplicate check. A
 * user name and password in the link become the download's sign-in in native memory; JavaScript never stores the link
 * with them (the engine drops them from the row too).
 */

import type { EnqueueRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import { classifyFtpLink, ftpLinkTitle } from './sources';

export type FtpRefusal =
  | 'invalid'
  | 'private'
  | 'unavailable'
  | 'not-video'
  | 'protected'
  | 'live'
  | 'sign-in'
  | 'not-found'
  | 'network'
  | 'server'
  | 'old-android';

export type FtpStartOutcome =
  | { kind: 'started'; downloadId: string; title: string }
  | { kind: 'duplicate'; downloadId: string | null; already: 'downloading' | 'downloaded' }
  | { kind: 'refused'; reason: FtpRefusal };

/** Pure: why the engine would not download an FTP file, from its probe failure. */
export function ftpRefusalFor(result: Extract<ProbeResult, { ok: false }>): FtpRefusal {
  switch (result.reason) {
    case 'DRM_PROTECTED':
      return 'protected';
    case 'LIVE_UNSUPPORTED':
      return 'live';
    case 'HTTP_403':
      return 'sign-in';
    case 'HTTP_404':
      return 'not-found';
    case 'NETWORK':
      return 'network';
    case 'POLICY_BLOCKED':
      return 'private';
    case 'UNSUPPORTED_FORMAT':
      return /android 8/i.test(result.message ?? '') ? 'old-android' : 'not-video';
    case 'NOT_MEDIA':
    case 'VIDEO_TRACK_MISSING':
    case 'AUDIO_TRACK_MISSING':
    case 'TRACK_MISMATCH':
      return 'not-video';
    default:
      return 'server';
  }
}

/** Probes and enqueues one FTP link. Never throws: every way it can end is an outcome. */
export async function startFtpDownload(engine: V2EnginePort | null, url: string): Promise<FtpStartOutcome> {
  const link = url.trim();
  const verdict = classifyFtpLink(link);
  if (verdict !== 'ok') {
    return { kind: 'refused', reason: verdict };
  }
  if (!engine) {
    return { kind: 'refused', reason: 'unavailable' };
  }
  let probe: ProbeResult;
  try {
    probe = await engine.probe({ url: link, kind: 'ftp', request: { useCookies: false } });
  } catch {
    // An older native build without FTP rejects the kind.
    return { kind: 'refused', reason: 'unavailable' };
  }
  if (!probe.ok) {
    return { kind: 'refused', reason: ftpRefusalFor(probe) };
  }
  const title = ftpLinkTitle(link);
  const request: EnqueueRequest = {
    url: link,
    kind: 'ftp',
    request: { useCookies: false },
    title,
    site: 'web',
    ...(probe.sizeBytes != null ? { estimatedBytes: probe.sizeBytes } : {}),
  };
  try {
    if (engine.enqueueUnique) {
      const result = await engine.enqueueUnique(request);
      if (result.outcome === 'ENQUEUED') {
        return { kind: 'started', downloadId: result.record.id, title };
      }
      return result.outcome === 'ALREADY_DOWNLOADING'
        ? { kind: 'duplicate', downloadId: result.record.id, already: 'downloading' }
        : { kind: 'duplicate', downloadId: result.libraryItemId, already: 'downloaded' };
    }
    const record = await engine.enqueue(request);
    return { kind: 'started', downloadId: record.id, title };
  } catch {
    return { kind: 'refused', reason: 'server' };
  }
}
