import type { TranslationKey } from './types';

export function resolvePluralForms(key: TranslationKey): {
  zero?: TranslationKey;
  one: TranslationKey;
  other: TranslationKey;
} {
  if (key === 'plurals.downloadsOther' || key.startsWith('plurals.downloads')) {
    return {
      zero: 'plurals.downloadsZero',
      one: 'plurals.downloadsOne',
      other: 'plurals.downloadsOther',
    };
  }
  if (key === 'plurals.videosOther' || key.startsWith('plurals.videos')) {
    return {
      zero: 'plurals.videosZero',
      one: 'plurals.videosOne',
      other: 'plurals.videosOther',
    };
  }
  if (key === 'plurals.itemsOther' || key.startsWith('plurals.items')) {
    return {
      zero: 'plurals.itemsZero',
      one: 'plurals.itemsOne',
      other: 'plurals.itemsOther',
    };
  }
  if (
    key === 'plurals.simultaneousDownloadsOther' ||
    key.startsWith('plurals.simultaneousDownloads')
  ) {
    return {
      one: 'plurals.simultaneousDownloadsOne',
      other: 'plurals.simultaneousDownloadsOther',
    };
  }
  return {
    one: key,
    other: key,
  };
}
