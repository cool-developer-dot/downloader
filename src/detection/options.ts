/**
 * Builds DownloadOptions from native probe results, and the EnqueueRequest each option downloads with.
 * Labels come in from the caller so this stays free of React Native and runs under `node --test`.
 */
import type {
  Container,
  EnqueueRequest,
  ProbeFailure,
  ProbeRequest,
  ProbeResult,
  ProbeVariant,
  RequestContext,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import { formatBytes, resolutionLabel } from '../media/format.ts';
import type { CandidateSource, DownloadOption, MediaItem, UnsupportedReason } from './types.ts';
import { displayHost, groupingKey } from './url.ts';

export interface OptionLabels {
  /** Label when the resolution is unknown. */
  original: string;
  noAudio: string;
  watermark: string;
}

export interface PageContext {
  currentUrl: string;
  pageTitle: string | null;
  /** Main-frame User-Agent, used when the item's frame did not report one. */
  userAgent: string | null;
  /** Day used in the fallback title "<host> <yyyy-mm-dd>". */
  date: Date;
}

/** An option with the facts that rank it against options built from the item's other sources. */
export interface RankedOption {
  option: DownloadOption;
  /** 2 = has audio, 1 = unknown, 0 = silent. */
  audio: number;
  watermarked: boolean;
  bitrate: number;
}

export type SourceOptions = { ranked: RankedOption[] } | { reason: UnsupportedReason };

type ProbeSuccess = Extract<ProbeResult, { ok: true }>;
type EnqueueFields = Omit<EnqueueRequest, 'url' | 'kind'>;

export function requestContextFor(item: MediaItem, page: PageContext): RequestContext {
  const context: RequestContext = { useCookies: true };
  const userAgent = item.userAgent || page.userAgent;
  const referer = item.frameUrl || page.currentUrl;
  if (userAgent) context.userAgent = userAgent;
  if (referer) context.referer = referer;
  return context;
}

/** Inline DASH manifests must be declared; everything else is sniffed by native, whose result kind wins. */
export function probeRequestFor(item: MediaItem, source: CandidateSource, page: PageContext): ProbeRequest {
  const request = requestContextFor(item, page);
  return source.kind === 'dash' && source.manifestText
    ? { url: source.url, kind: 'dash', manifestText: source.manifestText, request }
    : { url: source.url, request };
}

/** Item title, else page title, else "<host> <yyyy-mm-dd>". */
export function downloadTitle(item: MediaItem, page: PageContext): string {
  if (item.title) return item.title;
  if (page.pageTitle) return page.pageTitle;
  const host = displayHost(item.contentUrl ?? page.currentUrl) ?? displayHost(item.frameUrl);
  return host ? `${host} ${isoDay(page.date)}` : isoDay(page.date);
}

export function optionsFromProbe(
  item: MediaItem,
  source: CandidateSource,
  result: ProbeSuccess,
  page: PageContext,
  labels: OptionLabels,
): SourceOptions {
  return result.kind === 'progressive'
    ? { ranked: [progressiveOption(item, source, result, page, labels)] }
    : manifestOptions(item, source, result, page, labels);
}

/**
 * Best first, one option per quality: silent options are dropped when any option has audio, clean beats
 * watermarked, then height, no-mux over mux at the same height, known audio, bitrate and size.
 */
export function finalizeOptions(ranked: readonly RankedOption[]): DownloadOption[] {
  const anyAudible = ranked.some((entry) => entry.audio > 0);
  const seen = new Set<string>();
  return ranked
    .filter((entry) => !anyAudible || entry.audio > 0)
    .sort(compareRanked)
    .filter(({ option }) => {
      // Unknown resolutions share the "Original" label; keep those apart by format and size.
      const identity = option.height === null ? `${option.label}|${option.detail}` : option.label;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .map((entry) => entry.option);
}

export function unsupportedReason(failure: ProbeFailure): UnsupportedReason {
  switch (failure) {
    case 'DRM_PROTECTED':
    case 'LIVE_UNSUPPORTED':
    case 'UNSUPPORTED_FORMAT':
    case 'NOT_MEDIA':
    case 'POLICY_BLOCKED':
      return failure;
    default:
      return 'SOURCE_UNAVAILABLE';
  }
}

const REASON_PRIORITY: readonly UnsupportedReason[] = [
  'DRM_PROTECTED',
  'POLICY_BLOCKED',
  'LIVE_UNSUPPORTED',
  'UNSUPPORTED_FORMAT',
  'NOT_MEDIA',
  'SOURCE_UNAVAILABLE',
];

/** The reason that explains most when every source of an item failed. */
export function mostSpecificReason(reasons: readonly UnsupportedReason[]): UnsupportedReason {
  return REASON_PRIORITY.find((reason) => reasons.includes(reason)) ?? 'SOURCE_UNAVAILABLE';
}

function progressiveOption(
  item: MediaItem,
  source: CandidateSource,
  result: ProbeSuccess,
  page: PageContext,
  labels: OptionLabels,
): RankedOption {
  const progressive = source.kind === 'progressive' ? source : null;
  const audioUrl = progressive?.audioUrl;
  const hasAudio = audioUrl ? true : progressive?.hasAudio;
  const audio = hasAudio === true ? 2 : hasAudio === false ? 0 : 1;
  const watermarked = progressive?.watermarked === true;
  const { width, height, bitrate } = sourceDimensions(source);
  const resolution = resolutionLabel(width, height);
  const estimatedBytes = result.sizeBytes ?? progressive?.sizeBytes ?? null;

  const request: EnqueueRequest = { ...enqueueFields(item, page, result.durationMs), url: source.url, kind: 'progressive' };
  if (audioUrl) request.audioUrl = audioUrl;
  if (resolution) request.qualityLabel = resolution;
  if (estimatedBytes) request.estimatedBytes = estimatedBytes;

  return {
    option: {
      id: optionId(item, source, null),
      label: resolution ?? labels.original,
      detail: joinDetail([
        containerName(result.container, progressive?.mimeType),
        estimatedBytes ? formatBytes(estimatedBytes) : null,
        audio === 0 ? labels.noAudio : null,
        watermarked ? labels.watermark : null,
      ]),
      height,
      estimatedBytes,
      needsMux: Boolean(audioUrl),
      request,
    },
    audio,
    watermarked,
    bitrate: bitrate ?? 0,
  };
}

function manifestOptions(
  item: MediaItem,
  source: CandidateSource,
  result: ProbeSuccess,
  page: PageContext,
  labels: OptionLabels,
): SourceOptions {
  const base: EnqueueRequest = {
    ...enqueueFields(item, page, result.durationMs),
    url: source.url,
    kind: result.kind,
  };
  if (source.kind === 'dash' && source.manifestText) base.manifestText = source.manifestText;
  const hasAudioTrack = result.audioTracks.length > 0;

  if (result.variants.length === 0) {
    // A media playlist (or single-representation manifest): one quality, whatever the stream is.
    const { width, height, bitrate } = sourceDimensions(source);
    const resolution = resolutionLabel(width, height);
    const request: EnqueueRequest = { ...base };
    if (resolution) request.qualityLabel = resolution;
    return {
      ranked: [
        {
          option: {
            id: optionId(item, source, null),
            label: resolution ?? labels.original,
            detail: 'MP4',
            height,
            estimatedBytes: null,
            needsMux: false,
            request,
          },
          audio: hasAudioTrack ? 2 : 1,
          watermarked: false,
          bitrate: bitrate ?? 0,
        },
      ],
    };
  }

  const decodable = result.variants.filter((variant) => variant.decodable);
  if (decodable.length === 0) {
    return { reason: 'UNSUPPORTED_FORMAT' };
  }
  return { ranked: decodable.map((variant) => variantOption(item, source, variant, base, hasAudioTrack, labels)) };
}

function variantOption(
  item: MediaItem,
  source: CandidateSource,
  variant: ProbeVariant,
  base: EnqueueRequest,
  hasAudioTrack: boolean,
  labels: OptionLabels,
): RankedOption {
  const resolution = resolutionLabel(variant.width, variant.height);
  const request: EnqueueRequest = { ...base, variant: { videoId: variant.id } };
  if (resolution) request.qualityLabel = resolution;
  if (variant.estimatedBytes) request.estimatedBytes = variant.estimatedBytes;
  return {
    option: {
      id: optionId(item, source, variant.id),
      label: resolution ?? (variant.bitrate ? `${Math.round(variant.bitrate / 1000)} kbps` : labels.original),
      detail: joinDetail([
        // Native remuxes to MP4; only VP8 (with Vorbis) goes to WebM.
        variant.videoCodec?.toLowerCase().startsWith('vp8') ? 'WEBM' : 'MP4',
        variant.estimatedBytes ? formatBytes(variant.estimatedBytes) : null,
      ]),
      height: variant.height,
      estimatedBytes: variant.estimatedBytes,
      needsMux: variant.needsAudioMux,
      request,
    },
    audio: variant.needsAudioMux || hasAudioTrack ? 2 : 1,
    watermarked: false,
    bitrate: variant.bitrate ?? 0,
  };
}

function enqueueFields(item: MediaItem, page: PageContext, probedDurationMs: number | null): EnqueueFields {
  const fields: EnqueueFields = {
    request: requestContextFor(item, page),
    title: downloadTitle(item, page),
    site: item.site,
  };
  const pageUrl = item.contentUrl ?? page.currentUrl;
  const durationMs = item.durationSec !== null ? Math.round(item.durationSec * 1000) : probedDurationMs;
  if (pageUrl) fields.pageUrl = pageUrl;
  if (item.thumbnailUrl) fields.thumbnailUrl = item.thumbnailUrl;
  if (durationMs) fields.durationMs = durationMs;
  return fields;
}

function compareRanked(a: RankedOption, b: RankedOption): number {
  return (
    Number(a.watermarked) - Number(b.watermarked) ||
    (b.option.height ?? -1) - (a.option.height ?? -1) ||
    Number(a.option.needsMux) - Number(b.option.needsMux) ||
    b.audio - a.audio ||
    b.bitrate - a.bitrate ||
    (b.option.estimatedBytes ?? 0) - (a.option.estimatedBytes ?? 0)
  );
}

function sourceDimensions(source: CandidateSource): { width: number | null; height: number | null; bitrate: number | null } {
  return source.kind === 'dash'
    ? { width: null, height: null, bitrate: null }
    : { width: source.width ?? null, height: source.height ?? null, bitrate: source.bitrate ?? null };
}

function optionId(item: MediaItem, source: CandidateSource, variantId: string | null): string {
  const sourcePart =
    source.kind === 'dash' && source.manifestText
      ? `inline-${source.manifestText.length}`
      : (groupingKey(source.url) ?? source.url);
  return `${item.key}#${source.kind}:${sourcePart}${variantId === null ? '' : `#${variantId}`}`;
}

const MIME_CONTAINERS: readonly (readonly [RegExp, string])[] = [
  [/mp4/, 'MP4'],
  [/webm/, 'WEBM'],
  [/quicktime/, 'MOV'],
  [/matroska/, 'MKV'],
  [/3gpp/, '3GP'],
];

function containerName(container: Container, mimeType: string | undefined): string | null {
  if (container !== 'unknown') {
    return container.toUpperCase();
  }
  const normalized = mimeType?.toLowerCase() ?? '';
  return MIME_CONTAINERS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function joinDetail(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
