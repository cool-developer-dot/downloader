/**
 * Parses untrusted WebView message strings into DetectorMessage. Anything that is not a well-formed detector
 * message yields null, so the browser can route the string to its other channels.
 *
 * Envelope and required fields are strict: a wrong type drops the message (or the one candidate/source/player
 * it belongs to). Optional fields with a wrong type or out of range are omitted rather than trusted.
 */
import { isSiteId } from '../media/sites.ts';
import {
  DETECTOR_CHANNEL,
  DETECTOR_VERSION,
  type CandidateProvenance,
  type CandidateSource,
  type DetectorMessage,
  type FrameInfo,
  type PageCandidate,
  type PlayerHint,
} from './types.ts';
import { isHttpUrl } from './url.ts';

export const MAX_MESSAGE_LENGTH = 1_000_000;

const MAX_CANDIDATES = 50;
const MAX_SOURCES = 24;
const MAX_PLAYERS = 20;
const MAX_CODECS = 8;
const MAX_KEY_LENGTH = 1024;
const MAX_TITLE_LENGTH = 300;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_SHORT_TEXT_LENGTH = 100;
const MAX_MANIFEST_LENGTH = 200_000;
const MAX_DIMENSION = 16_384;
const MAX_BITRATE = 1_000_000_000;
const MAX_SIZE_BYTES = 1_000_000_000_000;
const MAX_DURATION_SEC = 7 * 24 * 3600;

const PROVENANCES: readonly CandidateProvenance[] = ['json', 'dom', 'network', 'manifest-body', 'web-download'];
const SITE_KEY = /^[a-z]+:\S+$/;

type Json = Record<string, unknown>;

export function parseDetectorMessage(raw: unknown): DetectorMessage | null {
  // Cheap rejection before JSON.parse: other channels may post large strings.
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH || !raw.includes(`"${DETECTOR_CHANNEL}"`)) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.ch !== DETECTOR_CHANNEL || data.v !== DETECTOR_VERSION) {
    return null;
  }
  const frame = readFrame(data.frame);
  if (!frame) {
    return null;
  }
  const base = { ch: DETECTOR_CHANNEL, v: DETECTOR_VERSION, frame } as const;

  switch (data.type) {
    case 'hello':
      return { ...base, type: 'hello' };
    case 'nav': {
      if (!isHttpUrl(data.url)) {
        return null;
      }
      const title = readText(data.title, MAX_TITLE_LENGTH);
      return title ? { ...base, type: 'nav', url: data.url, title } : { ...base, type: 'nav', url: data.url };
    }
    case 'candidates':
      return Array.isArray(data.candidates)
        ? { ...base, type: 'candidates', candidates: readList(data.candidates, MAX_CANDIDATES, readCandidate) }
        : null;
    case 'players':
      return Array.isArray(data.players)
        ? { ...base, type: 'players', players: readList(data.players, MAX_PLAYERS, readPlayer) }
        : null;
    case 'drm': {
      const keySystem = readText(data.keySystem, MAX_SHORT_TEXT_LENGTH);
      return keySystem ? { ...base, type: 'drm', keySystem } : null;
    }
    case 'policy':
      return data.blocked === 'youtube' ? { ...base, type: 'policy', blocked: 'youtube' } : null;
    default:
      return null;
  }
}

function readFrame(value: unknown): FrameInfo | null {
  if (!isRecord(value) || !isHttpUrl(value.url) || typeof value.isMain !== 'boolean') {
    return null;
  }
  const userAgent = typeof value.userAgent === 'string' ? value.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : '';
  return { url: value.url, isMain: value.isMain, userAgent };
}

function readCandidate(value: unknown): PageCandidate | null {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    value.key.length > MAX_KEY_LENGTH ||
    !(value.key.startsWith('url:') || SITE_KEY.test(value.key)) ||
    !isSiteId(value.site) ||
    !PROVENANCES.includes(value.provenance as CandidateProvenance) ||
    !Array.isArray(value.sources)
  ) {
    return null;
  }
  const sources = readList(value.sources, MAX_SOURCES, readSource);
  if (sources.length === 0) {
    return null;
  }
  const candidate: PageCandidate = {
    key: value.key,
    site: value.site,
    sources,
    provenance: value.provenance as CandidateProvenance,
  };
  const title = readText(value.title, MAX_TITLE_LENGTH);
  if (title) candidate.title = title;
  if (isHttpUrl(value.thumbnailUrl)) candidate.thumbnailUrl = value.thumbnailUrl;
  const durationSec = readNumber(value.durationSec, MAX_DURATION_SEC);
  if (durationSec !== undefined) candidate.durationSec = durationSec;
  if (isHttpUrl(value.contentUrl)) candidate.contentUrl = value.contentUrl;
  return candidate;
}

function readSource(value: unknown): CandidateSource | null {
  if (!isRecord(value) || !isHttpUrl(value.url)) {
    return null;
  }
  const url = value.url;
  switch (value.kind) {
    case 'progressive': {
      const source: CandidateSource = { kind: 'progressive', url };
      assignDimensions(source, value);
      const mimeType = readText(value.mimeType, MAX_SHORT_TEXT_LENGTH);
      if (mimeType) source.mimeType = mimeType;
      if (typeof value.hasAudio === 'boolean' || value.hasAudio === null) source.hasAudio = value.hasAudio;
      if (value.watermarked === true) source.watermarked = true;
      const sizeBytes = readInteger(value.sizeBytes, MAX_SIZE_BYTES);
      if (sizeBytes !== undefined) source.sizeBytes = sizeBytes;
      if (isHttpUrl(value.audioUrl)) source.audioUrl = value.audioUrl;
      return source;
    }
    case 'hls': {
      const source: CandidateSource = { kind: 'hls', url };
      assignDimensions(source, value);
      return source;
    }
    case 'dash': {
      if (value.manifestText === undefined) {
        return { kind: 'dash', url };
      }
      const manifestText = value.manifestText;
      return typeof manifestText === 'string' &&
        manifestText.length <= MAX_MANIFEST_LENGTH &&
        manifestText.includes('<MPD')
        ? { kind: 'dash', url, manifestText }
        : null;
    }
    default:
      return null;
  }
}

function assignDimensions(target: { width?: number; height?: number; bitrate?: number }, value: Json): void {
  const width = readInteger(value.width, MAX_DIMENSION);
  const height = readInteger(value.height, MAX_DIMENSION);
  const bitrate = readInteger(value.bitrate, MAX_BITRATE);
  if (width !== undefined) target.width = width;
  if (height !== undefined) target.height = height;
  if (bitrate !== undefined) target.bitrate = bitrate;
}

function readPlayer(value: unknown): PlayerHint | null {
  if (
    !isRecord(value) ||
    typeof value.isBlob !== 'boolean' ||
    typeof value.playing !== 'boolean' ||
    typeof value.visibleRatio !== 'number' ||
    !(value.visibleRatio >= 0 && value.visibleRatio <= 1)
  ) {
    return null;
  }
  const player: PlayerHint = { isBlob: value.isBlob, playing: value.playing, visibleRatio: value.visibleRatio };
  if (isHttpUrl(value.src)) player.src = value.src;
  if (isHttpUrl(value.poster)) player.poster = value.poster;
  const durationSec = readNumber(value.durationSec, MAX_DURATION_SEC);
  if (durationSec !== undefined) player.durationSec = durationSec;
  const width = readInteger(value.width, MAX_DIMENSION);
  const height = readInteger(value.height, MAX_DIMENSION);
  if (width !== undefined) player.width = width;
  if (height !== undefined) player.height = height;
  if (Array.isArray(value.mseCodecs)) {
    const codecs = readList(value.mseCodecs, MAX_CODECS, (codec) => readText(codec, MAX_SHORT_TEXT_LENGTH));
    if (codecs.length) player.mseCodecs = codecs;
  }
  return player;
}

function readList<T>(values: unknown[], max: number, read: (value: unknown) => T | null): T[] {
  const result: T[] = [];
  for (const value of values.slice(0, max)) {
    const item = read(value);
    if (item !== null) result.push(item);
  }
  return result;
}

/** Trimmed text with collapsed whitespace, truncated to `max`; null when empty or not a string. */
function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return text || null;
}

function readInteger(value: unknown, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max ? (value as number) : undefined;
}

function readNumber(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
