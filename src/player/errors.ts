/**
 * Centralized player error normalization + user-facing copy.
 */

import type { PlayerErrorCode } from './types';

export class PlaybackError extends Error {
  readonly code: PlayerErrorCode;

  constructor(code: PlayerErrorCode, message: string) {
    super(message);
    this.name = 'PlaybackError';
    this.code = code;
  }
}

const USER_MESSAGES: Record<PlayerErrorCode, string> = {
  MEDIA_NOT_FOUND: 'This video could not be found in your library.',
  FILE_UNAVAILABLE: 'File is no longer available.',
  SOURCE_RESOLUTION_FAILED: 'Unable to prepare this video for playback.',
  UNSUPPORTED_MEDIA:
    "This video's format or codec isn't supported on this device.",
  CORRUPT_MEDIA: 'This video file appears to be damaged or unreadable.',
  PERMISSION_DENIED: 'VidoraX does not have permission to play this file.',
  PLAYER_INIT_FAILED: 'Unable to start the video player.',
  PLAYBACK_FAILED: 'Playback failed. Try again.',
  PREPARATION_TIMEOUT: 'This video is taking too long to prepare.',
};

const ERROR_TITLES: Record<PlayerErrorCode, string> = {
  MEDIA_NOT_FOUND: 'Not found',
  FILE_UNAVAILABLE: 'Unavailable',
  SOURCE_RESOLUTION_FAILED: 'Unable to play',
  UNSUPPORTED_MEDIA: 'Unsupported format',
  CORRUPT_MEDIA: 'Unreadable video',
  PERMISSION_DENIED: 'Permission needed',
  PLAYER_INIT_FAILED: 'Player error',
  PLAYBACK_FAILED: 'Playback error',
  PREPARATION_TIMEOUT: 'Still preparing',
};

export function userMessageForPlayerError(code: PlayerErrorCode): string {
  return USER_MESSAGES[code];
}

export function titleForPlayerError(code: PlayerErrorCode): string {
  return ERROR_TITLES[code];
}

/** Recoverable errors that expose an explicit Retry action. */
export function isRecoverablePlayerError(code: PlayerErrorCode): boolean {
  return (
    code === 'PLAYER_INIT_FAILED' ||
    code === 'PLAYBACK_FAILED' ||
    code === 'PREPARATION_TIMEOUT' ||
    code === 'PERMISSION_DENIED'
  );
}

/**
 * Classify ambiguous native/player error text conservatively.
 * Unknown → PLAYBACK_FAILED (never invent a precise cause).
 */
export function classifyNativePlayerError(
  error: unknown,
): PlayerErrorCode {
  if (error instanceof PlaybackError) {
    return error.code;
  }

  let text = '';
  if (typeof error === 'string') {
    text = error;
  } else if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') {
      text = record.message;
    } else if (typeof record.code === 'string') {
      text = record.code;
    }
  }

  const lower = text.toLowerCase();
  if (!lower) {
    return 'PLAYBACK_FAILED';
  }

  if (
    lower.includes('unsupported') ||
    lower.includes('not supported') ||
    lower.includes('decoder') ||
    lower.includes('codec') ||
    lower.includes('mime')
  ) {
    return 'UNSUPPORTED_MEDIA';
  }

  if (
    lower.includes('corrupt') ||
    lower.includes('malformed') ||
    lower.includes('invalid media') ||
    lower.includes('unable to parse') ||
    lower.includes('decode error')
  ) {
    return 'CORRUPT_MEDIA';
  }

  if (
    lower.includes('permission') ||
    lower.includes('access denied') ||
    lower.includes('eacces') ||
    lower.includes('securityexception')
  ) {
    return 'PERMISSION_DENIED';
  }

  if (
    lower.includes('no such file') ||
    lower.includes('file not found') ||
    lower.includes('enoent') ||
    lower.includes('does not exist') ||
    lower.includes('unavailable')
  ) {
    return 'FILE_UNAVAILABLE';
  }

  return 'PLAYBACK_FAILED';
}

export function normalizePlayerError(error: unknown): PlaybackError {
  if (error instanceof PlaybackError) {
    return error;
  }
  const code = classifyNativePlayerError(error);
  return new PlaybackError(code, USER_MESSAGES[code]);
}
