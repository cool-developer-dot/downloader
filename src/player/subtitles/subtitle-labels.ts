/**
 * P3: the words for subtitle languages, tracks and encodings (the options rows and the Player's sheets share them).
 */

import type { TranslateFn, TranslationKey } from '@/localization';

import { baseLanguage } from './sidecar';
import { ENCODING_NAMES, type ResolvedEncoding, type SubtitleEncoding } from './subtitle-encoding';
import type { SubtitleFileRef } from './subtitle-record';

const LANGUAGE_KEYS: Readonly<Record<string, TranslationKey>> = {
  en: 'videoPlayer.languageEn',
  ur: 'videoPlayer.languageUr',
  ar: 'videoPlayer.languageAr',
  hi: 'videoPlayer.languageHi',
  pa: 'videoPlayer.languagePa',
  ps: 'videoPlayer.languagePs',
  fa: 'videoPlayer.languageFa',
  bn: 'videoPlayer.languageBn',
  es: 'videoPlayer.languageEs',
  fr: 'videoPlayer.languageFr',
  de: 'videoPlayer.languageDe',
  tr: 'videoPlayer.languageTr',
  zh: 'videoPlayer.languageZh',
  ja: 'videoPlayer.languageJa',
  ko: 'videoPlayer.languageKo',
  ru: 'videoPlayer.languageRu',
  pt: 'videoPlayer.languagePt',
  it: 'videoPlayer.languageIt',
  id: 'videoPlayer.languageId',
  ms: 'videoPlayer.languageMs',
};

/** "Urdu" / "اردو" for `ur`, `urd`, `ur-PK`; an unlisted tag is shown as it is (`sw`); null for none. */
export function subtitleLanguageName(t: TranslateFn, language: string | null | undefined): string | null {
  const base = baseLanguage(language);
  if (!base || base === 'und') {
    return null;
  }
  const key = LANGUAGE_KEYS[base];
  return key ? t(key) : (language as string);
}

/** A subtitle file in the track list: "Urdu · Episode 1.ur.vtt", or the file name alone. */
export function subtitleFileLabel(t: TranslateFn, file: Pick<SubtitleFileRef, 'name' | 'language'>): string {
  const language = subtitleLanguageName(t, file.language);
  return language ? `${language} · ${file.name}` : file.name;
}

/** A track inside the video: "English · in the video" (the player's own label, else the language, else its number). */
export function embeddedTrackLabel(
  t: TranslateFn,
  track: { label?: string | null; language?: string | null; name?: string | null },
  position: number,
): string {
  const name =
    track.label?.trim() ||
    subtitleLanguageName(t, track.language) ||
    track.name?.trim() ||
    t('videoPlayer.subtitleTrackNumber', { number: position + 1 });
  return t('videoPlayer.subtitleInVideo', { name });
}

/** An encoding choice: "Automatic (UTF-8)", "Windows-1256 (Arabic, Urdu)", "UTF-16 LE". */
export function subtitleEncodingLabel(t: TranslateFn, encoding: SubtitleEncoding, detected?: ResolvedEncoding | null): string {
  if (encoding === 'auto') {
    return t('videoPlayer.subtitleEncodingAuto', { encoding: detected ? ENCODING_NAMES[detected] : ENCODING_NAMES['utf-8'] });
  }
  if (encoding === 'windows-1256') {
    return t('videoPlayer.subtitleEncodingArabic', { encoding: ENCODING_NAMES[encoding] });
  }
  if (encoding === 'windows-1252') {
    return t('videoPlayer.subtitleEncodingWestern', { encoding: ENCODING_NAMES[encoding] });
  }
  return ENCODING_NAMES[encoding];
}
