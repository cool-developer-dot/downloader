import type { DownloadRecord, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadQualityOption } from '@/downloads/quality/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';

/** Shared fixtures for the Phase 7 handoff/projection tests (not used by app code). */
export const PAGE_URL = 'https://www.instagram.com/reels/DdTmTEEpBjw/';

export function qualityOption(overrides: Partial<DownloadQualityOption> = {}): DownloadQualityOption {
  return {
    id: 'progressive-720',
    label: '720p',
    sourceUrl: 'https://scontent.cdninstagram.com/o/9f3a1c?token=abc&oe=1',
    resolution: '1280x720',
    width: 1280,
    height: 720,
    bitrate: 2_400_000,
    averageBitrate: null,
    videoBitrate: null,
    audioBitrate: null,
    codec: null,
    videoCodec: 'avc1.4d401f',
    audioCodec: 'mp4a.40.2',
    rawCodec: null,
    container: 'mp4',
    mimeType: 'video/mp4',
    fileSize: '5242880',
    estimatedFileSize: 5_242_880,
    fps: null,
    frameRate: null,
    streamType: 'PROGRESSIVE',
    isHls: false,
    isProgressive: true,
    isAudioOnly: false,
    mediaType: 'video',
    hasAudio: true,
    hasVideo: true,
    downloadable: true,
    unavailableReason: null,
    ...overrides,
  };
}

export function requestContext(overrides: Partial<MediaRequestContext> = {}): MediaRequestContext {
  return {
    pageUrl: PAGE_URL,
    referer: PAGE_URL,
    userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
    cookiesRequired: true,
    hasCookies: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36', Accept: 'video/*' },
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function downloadRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: 'dl-1',
    state: 'queued',
    title: 'Instagram Reel',
    site: 'instagram',
    kind: 'progressive',
    pageUrl: PAGE_URL,
    thumbnailUrl: null,
    qualityLabel: '720p',
    bytesDone: 0,
    totalBytes: 5_242_880,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    libraryItemId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function libraryItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'dl-1',
    title: 'Instagram Reel',
    site: 'instagram',
    pageUrl: PAGE_URL,
    fileUri: 'file:///data/user/0/com.anonymous.vidorax/files/library/instagram/Instagram Reel_dl-1.mp4',
    fileName: 'Instagram Reel_dl-1.mp4',
    mimeType: 'video/mp4',
    container: 'mp4',
    videoCodec: 'avc1.4d401f',
    audioCodec: 'mp4a.40.2',
    hasAudio: true,
    width: 1280,
    height: 720,
    durationMs: 30_000,
    sizeBytes: 5_242_880,
    thumbnailUri: null,
    favorite: false,
    galleryUri: null,
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_060_000,
    ...overrides,
  };
}
