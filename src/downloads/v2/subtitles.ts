/**
 * H19 Subtitles. Pure.
 *
 * Off by default. When on, the subtitle tracks of an HLS or DASH download are chosen by the setting — All, the app's
 * language (falling back to the first track), or the first track only — and the native side fetches them beside the
 * video once it completed (`<video>.<lang>.vtt`). Protected, embedded (stpp/wvtt) and other refused tracks are never
 * chosen. A saved subtitle can be exported as .vtt, or as .srt converted here.
 */

import type { SubtitleTrackInfo } from '@modules/vidorax-media/src/subtitles.types';

export type SubtitleMode = 'all' | 'app_language' | 'first';

export const SUBTITLE_MODES: readonly SubtitleMode[] = ['all', 'app_language', 'first'];
export const DEFAULT_SUBTITLE_MODE: SubtitleMode = 'app_language';

export function normalizeSubtitleMode(raw: unknown): SubtitleMode {
  return typeof raw === 'string' && (SUBTITLE_MODES as readonly string[]).includes(raw)
    ? (raw as SubtitleMode)
    : DEFAULT_SUBTITLE_MODE;
}

/** "en-US" → "en"; null for none. */
export function primaryLanguage(language: string | null | undefined): string | null {
  const primary = language?.trim().toLowerCase().split(/[-_]/)[0];
  return primary ? primary : null;
}

/** The ids of the tracks to download for [mode]; refused or unknown-format tracks are never chosen. */
export function selectSubtitleTracks(
  tracks: readonly SubtitleTrackInfo[],
  mode: SubtitleMode,
  appLanguage: string,
): string[] {
  const usable = tracks.filter((track) => track.refused === null && track.format !== null);
  if (usable.length === 0) {
    return [];
  }
  if (mode === 'all') {
    return usable.map((track) => track.id);
  }
  if (mode === 'app_language') {
    const wanted = primaryLanguage(appLanguage);
    const matching = usable.filter((track) => primaryLanguage(track.language) === wanted);
    if (matching.length > 0) {
      // Prefer the full subtitles over a forced-only track in the same language.
      const full = matching.find((track) => !track.isForced) ?? matching[0];
      return full ? [full.id] : [];
    }
  }
  const first = usable[0];
  return first ? [first.id] : [];
}

/** A safe export name: "<title>.<lang>.<ext>" (letters of every script kept, path characters removed). */
export function subtitleExportFileName(title: string, language: string | null, format: 'vtt' | 'srt'): string {
  const base =
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Video';
  const lang = (language ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 16) || 'und';
  return `${base}.${lang}.${format}`;
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})/;

/** "01:02.345" or "1:01:02.345" → "00:01:02,345" / "01:01:02,345". */
function srtTime(vtt: string): string {
  const parts = vtt.split(':');
  const [seconds = '00.000'] = parts.slice(-1);
  const minutes = parts.length >= 2 ? parts[parts.length - 2] ?? '0' : '0';
  const hours = parts.length === 3 ? parts[0] ?? '0' : '0';
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.replace('.', ',').padStart(6, '0')}`;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
  '&quot;': '"',
  '&apos;': "'",
};

/** WebVTT cue text as plain SRT text: tags (b, i, u, c.x, v Name, lang, ruby, timestamps) removed, entities decoded. */
export function plainCueText(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** A WebVTT file as SRT: numbered cues, `,` milliseconds, cue settings dropped, NOTE/STYLE/REGION blocks left out. */
export function vttToSrt(vtt: string): string {
  const blocks = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0);
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0 || timingIndex > 1) {
      continue;
    }
    const match = TIMING.exec(lines[timingIndex] ?? '');
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const text = lines
      .slice(timingIndex + 1)
      .map(plainCueText)
      .filter((line) => line.trim().length > 0);
    if (text.length === 0) {
      continue;
    }
    cues.push(`${cues.length + 1}\n${srtTime(match[1])} --> ${srtTime(match[2])}\n${text.join('\n')}`);
  }
  return cues.length > 0 ? `${cues.join('\n\n')}\n` : '';
}
