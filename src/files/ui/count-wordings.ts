/**
 * Files wordings that carry a count, as `{ one, other }` forms for the app's plural helper:
 * `translatePlural(count, forms, params, language)` uses `one` for exactly 1 and `other` for 0 and 2 or more, the same
 * choice as the `count === 1 ? t('….One') : t('…', { count })` wordings elsewhere in Files. `other` is each wording's
 * existing key; the helper adds `count` to the params.
 */
import type { TranslationKey } from '@/localization/types';

export type CountForms = Readonly<{ one: TranslationKey; other: TranslationKey }>;

/** F5 · the batch rename header: "Rename 1 file", "Rename {count} files". */
export const renameTitleForms: CountForms = { one: 'fileManager.renameTitleOne', other: 'fileManager.renameTitle' };

/** F7 · the toast after a tag goes on the selected files: "“{tag}” added to 1 file", "… to {count} files". */
export const tagAddedForms: CountForms = { one: 'fileManager.tagAddedOne', other: 'fileManager.tagAdded' };

/** F7 · the toast after Organize now: "1 file organized", "{count} files organized". */
export const organizeDoneForms: CountForms = { one: 'fileManager.organizeDoneOne', other: 'fileManager.organizeDone' };

/** F3 · File details' exact size: "1 byte", "{bytes} bytes"; the count is the whole number of bytes (`wholeBytes`). */
export const rowSizeExactForms: CountForms = { one: 'fileManager.rowSizeExactOne', other: 'fileManager.rowSizeExact' };
