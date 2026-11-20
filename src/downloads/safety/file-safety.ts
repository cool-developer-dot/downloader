/**
 * P8 #461 Malware Warning, JavaScript half: the native check (`checkLibraryFileSafety`, `checkIncomingFileSafety`,
 * the probe's `disguisedAs`) compares a file's name with its first bytes on the device. This turns its verdict into
 * the warning's words and decides whether an action (open, share, extract, save) may go on. Pure.
 */

import type { ContentKind, FileSafetyCheck } from '@modules/vidorax-media/src/VidoraMedia.types';
import type { TranslationKey } from '@/localization/types';

export type FileSafetyAction = 'open' | 'share' | 'extract' | 'save';

/** What a detected kind is called in the warning. */
export const CONTENT_KIND_KEYS: Record<ContentKind, TranslationKey> = {
  apk: 'fileSafety.kindApk',
  jar: 'fileSafety.kindProgram',
  dex: 'fileSafety.kindApk',
  exe: 'fileSafety.kindExe',
  elf: 'fileSafety.kindProgram',
  macho: 'fileSafety.kindProgram',
  msi: 'fileSafety.kindExe',
  script: 'fileSafety.kindScript',
  zip: 'fileSafety.kindArchive',
  rar: 'fileSafety.kindArchive',
  '7z': 'fileSafety.kindArchive',
};

const ACTION_KEYS: Record<FileSafetyAction, TranslationKey> = {
  open: 'fileSafety.openAnyway',
  share: 'fileSafety.shareAnyway',
  extract: 'fileSafety.extractAnyway',
  save: 'fileSafety.saveAnyway',
};

export type FileSafetyWarning = {
  titleKey: TranslationKey;
  messageKey: TranslationKey;
  /** The `{kind}` placeholder's key (what the file really is), when known. */
  kindKey: TranslationKey | null;
  proceedKey: TranslationKey;
};

const KNOWN_KINDS = new Set(Object.keys(CONTENT_KIND_KEYS));
const KNOWN_REASONS = new Set(['disguised', 'double_extension', 'program']);

/** A well-formed native verdict, or null (an older build, a failed check: no warning then). */
export function normalizeFileSafety(value: unknown): FileSafetyCheck | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const reason = typeof record.reason === 'string' && KNOWN_REASONS.has(record.reason) ? record.reason : null;
  const detected = typeof record.detected === 'string' && KNOWN_KINDS.has(record.detected) ? record.detected : null;
  return {
    risky: record.risky === true && reason != null,
    reason: reason as FileSafetyCheck['reason'],
    detected: detected as ContentKind | null,
  };
}

/** The warning for a risky verdict; null when the file needs none. */
export function fileSafetyWarning(check: FileSafetyCheck | null, action: FileSafetyAction): FileSafetyWarning | null {
  if (!check?.risky || !check.reason) {
    return null;
  }
  const kindKey = check.detected ? CONTENT_KIND_KEYS[check.detected] : null;
  const proceedKey = ACTION_KEYS[action];
  switch (check.reason) {
    case 'disguised':
      return {
        titleKey: 'fileSafety.disguisedTitle',
        messageKey: kindKey ? 'fileSafety.disguisedMessage' : 'fileSafety.disguisedMessageUnknown',
        kindKey,
        proceedKey,
      };
    case 'double_extension':
      return { titleKey: 'fileSafety.disguisedTitle', messageKey: 'fileSafety.doubleExtensionMessage', kindKey, proceedKey };
    default:
      return { titleKey: 'fileSafety.programTitle', messageKey: 'fileSafety.programMessage', kindKey, proceedKey };
  }
}

/**
 * Pure orchestration: true when the action may go on — the file needs no warning, the check could not run, or the
 * user chose "… anyway" (`confirm` shows the warning). A confirm that throws counts as Cancel.
 */
export async function allowFileAction(
  check: () => Promise<unknown>,
  action: FileSafetyAction,
  confirm: (warning: FileSafetyWarning) => Promise<boolean>,
): Promise<boolean> {
  let verdict: FileSafetyCheck | null = null;
  try {
    verdict = normalizeFileSafety(await check());
  } catch {
    verdict = null;
  }
  const warning = fileSafetyWarning(verdict, action);
  if (!warning) {
    return true;
  }
  try {
    return (await confirm(warning)) === true;
  } catch {
    return false;
  }
}

/**
 * Pure: one notice per disguised source per app run. The engine probes the same link several times while a page
 * plays; the user hears about it once.
 */
export function createDisguisedNotifier(notify: (kind: ContentKind, url: string) => void): (url: string, kind: unknown) => boolean {
  const told = new Set<string>();
  return (url, kind) => {
    if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind) || told.has(url)) {
      return false;
    }
    told.add(url);
    if (told.size > 200) {
      told.delete(told.values().next().value as string);
    }
    notify(kind as ContentKind, url);
    return true;
  };
}
