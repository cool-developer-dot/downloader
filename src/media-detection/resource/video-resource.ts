/** Shared video format authority. Hints admit candidates; bytes prove resources. */
import { sniffMediaSignature } from '@/downloads/engine/media-signature';

import type { Mp4BoxWalkVerdict } from './mp4-box-walk';

export const VIDEO_FORMATS = {
  // F4V is ISO-BMFF (Flash's MP4 profile); DivX/XviD files are AVI.
  mp4: { mime: 'video/mp4', aliases: ['video/mp4', 'application/mp4', 'video/x-f4v'] },
  m4v: { mime: 'video/x-m4v', aliases: ['video/x-m4v'] },
  mov: { mime: 'video/quicktime', aliases: ['video/quicktime'] },
  webm: { mime: 'video/webm', aliases: ['video/webm'] },
  avi: { mime: 'video/x-msvideo', aliases: ['video/x-msvideo', 'video/avi', 'video/msvideo', 'video/divx', 'video/x-divx'] },
  wmv: { mime: 'video/x-ms-wmv', aliases: ['video/x-ms-wmv', 'video/x-ms-asf', 'application/vnd.ms-asf'] },
  hls: { mime: 'application/vnd.apple.mpegurl', aliases: ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl', 'application/mpegurl'] },
} as const;

export type VideoResourceFormat = keyof typeof VIDEO_FORMATS;
export type VideoResourceResolution = {
  state: 'VERIFIED' | 'TRANSIENT_UNRESOLVED' | 'PROVEN_UNSUPPORTED';
  format: VideoResourceFormat | null;
  mimeType: string | null;
  reason: string;
  standaloneFragmented: boolean;
};

export function normalizeVideoMime(raw?: string | null): string | null {
  return raw?.split(';')[0]?.trim().toLowerCase() || null;
}

export function videoFormatFromMime(raw?: string | null): VideoResourceFormat | null {
  const mime = normalizeVideoMime(raw);
  for (const [format, spec] of Object.entries(VIDEO_FORMATS)) {
    if ((spec.aliases as readonly string[]).includes(mime ?? '')) return format as VideoResourceFormat;
  }
  return null;
}

export function videoFormatFromExtension(ext?: string | null): VideoResourceFormat | null {
  const normalized = ext?.replace(/^\./, '').toLowerCase();
  if (normalized === 'm3u8' || normalized === 'm3u') return 'hls';
  if (normalized === 'f4v') return 'mp4';
  if (normalized === 'divx') return 'avi';
  return normalized && Object.hasOwn(VIDEO_FORMATS, normalized)
    ? normalized as VideoResourceFormat : null;
}

export function videoFormatFromUrl(url?: string | null): VideoResourceFormat | null {
  try {
    const name = new URL(url ?? '').pathname.split('/').pop() ?? '';
    return name.includes('.') ? videoFormatFromExtension(name.split('.').pop()) : null;
  } catch { return null; }
}

/** Only compatible ISO BMFF suffixes refine an MP4 MIME. Unknown video/* is not MP4. */
export function resolveVideoFormatHint(input: {
  url?: string | null; mimeType?: string | null; extension?: string | null;
  contentDisposition?: string | null;
}): VideoResourceFormat | null {
  const mime = videoFormatFromMime(input.mimeType);
  const dispositionName = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(input.contentDisposition ?? '')?.[1];
  let disposition: VideoResourceFormat | null = null;
  try { disposition = videoFormatFromExtension(decodeURIComponent(dispositionName ?? '').split('.').pop()); } catch { /* invalid filename */ }
  const ext = videoFormatFromExtension(input.extension) ?? videoFormatFromUrl(input.url) ?? disposition;
  if (mime === 'mp4' && (ext === 'm4v' || ext === 'mov')) return ext;
  return mime ?? ext;
}

/** A partial probe can be unresolved. Never turn absent bytes into verified video. */
export function resolveVideoResource(input: {
  url: string; finalUrl?: string | null; mimeType?: string | null;
  contentDisposition?: string | null; bytes?: Uint8Array;
  totalBytes?: number | null; coversEntireResource?: boolean;
  isDrm?: boolean; isSegment?: boolean;
  /** Box walk past the probe window, for ISO BMFF windows that end inside metadata (mp4-box-walk.ts). */
  mp4BoxWalk?: Mp4BoxWalkVerdict | null;
}): VideoResourceResolution {
  const hint = resolveVideoFormatHint({ ...input, url: input.finalUrl || input.url });
  const result = (state: VideoResourceResolution['state'], reason: string, format = hint, standaloneFragmented = false): VideoResourceResolution => ({
    state, reason, format, mimeType: format ? VIDEO_FORMATS[format].mime : null, standaloneFragmented,
  });
  if (input.isDrm) return result('PROVEN_UNSUPPORTED', 'DRM_UNSUPPORTED');
  if (input.isSegment) return result('PROVEN_UNSUPPORTED', 'SEGMENT_RESOURCE');
  if (!/^https?:\/\//i.test(input.finalUrl || input.url)) return result('PROVEN_UNSUPPORTED', 'UNSUPPORTED_TRANSPORT');
  const mime = normalizeVideoMime(input.mimeType);
  if (mime && /^(?:text\/html|application\/xhtml\+xml|image\/)/.test(mime)) return result('PROVEN_UNSUPPORTED', 'HTML_OR_IMAGE_RESPONSE');
  if (mime && /(?:\/|\+)json$/.test(mime)) return result('PROVEN_UNSUPPORTED', 'JSON_RESPONSE');
  if (hint === 'hls') return result('TRANSIENT_UNRESOLVED', 'MANIFEST_VERIFICATION_REQUIRED');
  if (!input.bytes?.length) return result('TRANSIENT_UNRESOLVED', 'BYTES_PENDING');
  const sig = sniffMediaSignature(input.bytes, {
    resourceTotalBytes: input.totalBytes,
    coversEntireResource: input.coversEntireResource,
    requireStandaloneMp4: true,
  });
  let sigKind = sig.kind;
  let structureProven = sig.ok;
  let standaloneFragmented = sig.mp4Kind === 'FRAGMENTED_COMPLETE';
  if (!sig.ok && sig.reason === 'mp4_structure_unproven' && input.mp4BoxWalk) {
    const walk = input.mp4BoxWalk;
    if (walk.state === 'NO_MEDIA_DATA') return result('PROVEN_UNSUPPORTED', 'init_segment');
    if (walk.state === 'INVALID') return result('PROVEN_UNSUPPORTED', 'invalid_box_size');
    if (walk.state === 'MEDIA_DATA') {
      // Same brand rule as the in-window sniff: a QuickTime major brand is MOV.
      sigKind = String.fromCharCode(...input.bytes.subarray(8, 12)) === 'qt  ' ? 'mov' : 'mp4';
      standaloneFragmented = walk.boxType === 'moof';
      structureProven = true;
    }
  }
  if (!structureProven) {
    const proven = ['html', 'json'].includes(sig.kind) || ['init_segment', 'media_fragment', 'drm_protected', 'invalid_box_size'].includes(sig.reason ?? '');
    return result(proven ? 'PROVEN_UNSUPPORTED' : 'TRANSIENT_UNRESOLVED', sig.reason ?? 'BYTES_PENDING');
  }
  const format = sigKind === 'mp4'
    ? (hint === 'm4v' || hint === 'mov' ? hint : 'mp4')
    : videoFormatFromExtension(sigKind);
  if (!format || format === 'hls') return result('PROVEN_UNSUPPORTED', 'UNSUPPORTED_FORMAT');
  // A contradictory concrete MIME is evidence of an invalid/changed response.
  const declared = videoFormatFromMime(mime);
  const iso = (f: VideoResourceFormat) => f === 'mp4' || f === 'm4v' || f === 'mov';
  if (declared && declared !== format && !(iso(declared) && iso(format))) return result('PROVEN_UNSUPPORTED', 'MIME_SIGNATURE_MISMATCH');
  return result('VERIFIED', 'STRUCTURAL_VIDEO_EVIDENCE', format, standaloneFragmented);
}

/** Container support cannot promise decoder availability. All playback may fail by codec. */
export function prefersExternalVideoPlayback(input: { mimeType?: string | null; fileName?: string | null; container?: string | null }): boolean {
  const format = resolveVideoFormatHint({ mimeType: input.mimeType, extension: input.container ?? input.fileName?.split('.').pop() });
  return format === 'avi' || format === 'wmv';
}
