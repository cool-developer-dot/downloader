/**
 * P13 #667: the subtitles a TV gets. A Cast receiver reads WebVTT only, so the subtitle file the user chose (SRT, ASS /
 * SSA or VTT, parsed by P3) is written out as WebVTT and served next to the video. Pure, so it is unit tested.
 *
 * - The P3 sync offset (#597) is applied: a cue shows on the TV at the same moment it shows on the phone.
 * - Text only, as P3 draws it (ASS styling and positions were already dropped by the parser).
 * - Cues that end before 0:00 after the offset are left out; a start before 0:00 becomes 0:00.
 */

import type { SubtitleCue } from '../subtitles/cues';
import { parseAss, parseSrt, parseVtt, type SubtitleFormat } from '../subtitles/parse-subtitles';

/** `HH:MM:SS.mmm`, as WebVTT writes times. */
export function webVttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (value: number, size: number) => String(value).padStart(size, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

/** Cue text as WebVTT needs it: markup characters escaped, no blank line (it would end the cue), no "-->". */
function cueText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Parsed cues as a WebVTT file, shifted by the P3 sync offset (positive: later). */
export function cuesToWebVtt(cues: readonly SubtitleCue[], offsetMs = 0): string {
  const shift = Number.isFinite(offsetMs) ? offsetMs : 0;
  const blocks: string[] = [];
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const cue of sorted) {
    const start = Math.max(0, cue.startMs + shift);
    const end = cue.endMs + shift;
    const text = cueText(cue.text);
    if (end <= start || text.length === 0) {
      continue;
    }
    blocks.push(`${webVttTime(start)} --> ${webVttTime(end)}\n${text}`);
  }
  return `WEBVTT\n\n${blocks.map((block) => `${block}\n`).join('\n')}`;
}

export function srtToWebVtt(text: string, offsetMs = 0): string {
  return cuesToWebVtt(parseSrt(text), offsetMs);
}

export function assToWebVtt(text: string, offsetMs = 0): string {
  return cuesToWebVtt(parseAss(text).cues, offsetMs);
}

/** Any subtitle file P3 reads, as WebVTT (a VTT file is rewritten too, so its offset and markup are handled alike). */
export function subtitleToWebVtt(text: string, format: SubtitleFormat, offsetMs = 0): string {
  switch (format) {
    case 'srt':
      return srtToWebVtt(text, offsetMs);
    case 'ass':
      return assToWebVtt(text, offsetMs);
    case 'vtt':
      return cuesToWebVtt(parseVtt(text), offsetMs);
  }
}

/** True when the WebVTT text has at least one cue (an empty file is not worth sending). */
export function webVttHasCues(vtt: string): boolean {
  return vtt.includes('-->');
}
