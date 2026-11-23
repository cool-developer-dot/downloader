/**
 * P3 #590 Auto Detect Subtitle: subtitle files named like the video, next to it. Pure.
 *
 * `Episode 1.mp4` matches `Episode 1.srt`, `Episode 1.en.srt`, `Episode 1.ur.vtt`, `Episode 1.en-US.2.vtt` (H19 saves
 * downloaded subtitles as `<video>.<lang>.vtt`, `.<lang>.2.vtt` …) and `.ass` / `.ssa`; names compare without case.
 */

import { SUBTITLE_EXTENSIONS, type SubtitleFormat } from './parse-subtitles';

export type SidecarSubtitle = {
  name: string;
  format: SubtitleFormat;
  /** The language tag in the name (`en`, `ur`, `pt-BR`); null when it has none or says `und`. */
  language: string | null;
};

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() } : { stem: name, extension: '' };
}

/** The subtitle files among `names` that belong to the video `videoFileName`, the plainest names first. */
export function matchSidecarSubtitles(videoFileName: string, names: readonly string[]): SidecarSubtitle[] {
  const base = splitExtension(videoFileName).stem.toLowerCase();
  if (!base) {
    return [];
  }
  const found: (SidecarSubtitle & { rank: number })[] = [];
  for (const name of names) {
    const { stem, extension } = splitExtension(name);
    const format = SUBTITLE_EXTENSIONS[extension];
    if (!format) {
      continue;
    }
    const lower = stem.toLowerCase();
    if (lower === base) {
      found.push({ name, format, language: null, rank: 0 });
      continue;
    }
    if (!lower.startsWith(`${base}.`)) {
      continue;
    }
    const tags = stem.slice(base.length + 1).split('.');
    const tag = tags.find((part) => LANGUAGE_TAG.test(part)) ?? null;
    const language = tag && tag.toLowerCase() !== 'und' ? tag : null;
    found.push({ name, format, language, rank: 1 });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(({ name, format, language }) => ({ name, format, language }));
}

/** "en-US" / "eng" → "en"; null for none. Common three-letter codes are mapped to their two-letter ones. */
export function baseLanguage(language: string | null | undefined): string | null {
  const primary = language?.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) {
    return null;
  }
  return THREE_LETTER[primary] ?? primary;
}

const THREE_LETTER: Readonly<Record<string, string>> = {
  eng: 'en',
  urd: 'ur',
  ara: 'ar',
  hin: 'hi',
  pan: 'pa',
  pus: 'ps',
  fas: 'fa',
  per: 'fa',
  ben: 'bn',
  spa: 'es',
  fra: 'fr',
  fre: 'fr',
  deu: 'de',
  ger: 'de',
  tur: 'tr',
  zho: 'zh',
  chi: 'zh',
  jpn: 'ja',
  kor: 'ko',
  rus: 'ru',
  por: 'pt',
  ita: 'it',
  ind: 'id',
  msa: 'ms',
  may: 'ms',
};

/**
 * Which detected file to show when the user has chosen nothing for this video: one in the app's language, else
 * English, else one without a language in its name, else the first.
 */
export function preferredSidecar<T extends { language: string | null }>(files: readonly T[], appLanguage: string): T | null {
  const app = baseLanguage(appLanguage);
  return (
    files.find((file) => baseLanguage(file.language) === app) ??
    files.find((file) => baseLanguage(file.language) === 'en') ??
    files.find((file) => file.language == null) ??
    files[0] ??
    null
  );
}
