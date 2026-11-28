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

// The English of these needs no noun ("1 moved to Trips"), but the Urdu verb does: گئی / سکی / رہی for one file,
// گئیں / سکیں / رہیں for more.

/** F4 · the toast after Move: "{count} moved to {folder}". */
export const movedCountForms: CountForms = { one: 'fileManager.movedCount', other: 'fileManager.movedCount' };

/** F4 and F10 · after Move or Move to Private: "{count} couldn’t be moved". */
export const moveFailedForms: CountForms = { one: 'fileManager.moveFailed', other: 'fileManager.moveFailed' };

/** F5 · after a batch rename: "{count} renamed". */
export const renamedCountForms: CountForms = { one: 'fileManager.renamedCount', other: 'fileManager.renamedCount' };

/** F7 · after Hide: "{count} hidden. To lock files, use Private folder." */
export const hiddenCountForms: CountForms = { one: 'fileManager.hiddenCount', other: 'fileManager.hiddenCount' };

/** F10 · after Add files to Private: "{count} moved to Private". */
export const addFilesDoneForms: CountForms = { one: 'fileManager.addFilesDone', other: 'fileManager.addFilesDone' };

/** F10 · after Add files to Private: "{count} couldn’t be moved and stayed in your library". */
export const addFilesFailedForms: CountForms = { one: 'fileManager.addFilesFailed', other: 'fileManager.addFilesFailed' };

/** F8 · the Undo bar: "{count} couldn’t be deleted". */
export const undoFailedForms: CountForms = { one: 'fileManager.undoFailed', other: 'fileManager.undoFailed' };
