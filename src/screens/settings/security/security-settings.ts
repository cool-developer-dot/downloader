/**
 * Files F10 · design 64 Security: what the page shows, and its one new stored setting.
 *
 * - App lock and Lock after are App Lock's own (setup / disable flows). App Lock locks the moment VidoraX leaves the
 *   screen (#917 Auto lock), so Lock after reads "Immediately"; there are no other choices.
 * - Block screenshots (#916) is new: the whole app, default off, kept in MMKV
 *   (`vidorax.mmkv.privacy.blockScreenshotsApp.v1`). Private keeps its own switch (Settings → Privacy).
 * - File encryption (#909), Hide history and Malware warning are protections VidoraX never turns off: Private files are
 *   always encrypted (AES-256-GCM, no unencrypted mode), a file moved into Private always leaves every history, and P8
 *   always warns before a file that isn't what its name says is opened. Encryption and Hide history show a switch
 *   that stays On; Malware warning is a plain row reading "Always on" (P8 has no setting to show as a switch).
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvGetObject, mmkvSetBoolean, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export type SecuritySettings = { blockScreenshots: boolean };

export const DEFAULT_SECURITY_SETTINGS: Readonly<SecuritySettings> = { blockScreenshots: false };

/** The protections shown as switches that are always on. */
export const ALWAYS_ON_PROTECTIONS = ['fileEncryption', 'hideHistory', 'malwareWarning'] as const;
export type AlwaysOnProtection = (typeof ALWAYS_ON_PROTECTIONS)[number];

/** The always-on protections drawn as a plain info row ("Malware warning · Always on") instead of a switch. */
export const INFO_ROW_PROTECTIONS: readonly AlwaysOnProtection[] = ['malwareWarning'];

export function isInfoRowProtection(key: AlwaysOnProtection): boolean {
  return INFO_ROW_PROTECTIONS.includes(key);
}

export type LockAfter = 'immediately';

export type SecurityPageModel = {
  appLock: { on: boolean };
  /** Shown while App Lock is on. */
  lockAfter: LockAfter | null;
  blockScreenshots: { on: boolean };
  protections: Record<AlwaysOnProtection, { on: true; canChange: false }>;
  /** "Change PIN" while App Lock is on; "Set up App Lock" otherwise. */
  pinButton: 'change-pin' | 'set-up-app-lock';
};

export function normalizeSecuritySettings(value: { blockScreenshots?: unknown } | null | undefined): SecuritySettings {
  return { blockScreenshots: value?.blockScreenshots === true };
}

export function securityPageModel(input: { appLockEnabled: boolean; settings: SecuritySettings }): SecurityPageModel {
  const protections = {} as SecurityPageModel['protections'];
  for (const key of ALWAYS_ON_PROTECTIONS) {
    protections[key] = { on: true, canChange: false };
  }
  return {
    appLock: { on: input.appLockEnabled },
    lockAfter: input.appLockEnabled ? 'immediately' : null,
    blockScreenshots: { on: input.settings.blockScreenshots },
    protections,
    pinButton: input.appLockEnabled ? 'change-pin' : 'set-up-app-lock',
  };
}

/**
 * F11 (Faran, 2026-11-28): where these settings are kept so a backup carries them. It's a `vidorax.files.*` key, so
 * F17's `registerFilesBackupKey` takes it (`files-backup-keys.ts`). It holds only `{ blockScreenshots }`, never
 * anything of App Lock's.
 */
export const SECURITY_SETTINGS_BACKUP_KEY = mmkvKeys.filesSecuritySettings;

/** What a backup holds for these settings. */
export function securitySettingsBackupValue(settings: SecuritySettings): SecuritySettings {
  return { blockScreenshots: settings.blockScreenshots === true };
}

/** The settings from storage: the backed-up key when it's there, else the older app-wide Block screenshots value. */
export function securitySettingsFromStorage(input: { stored: unknown; legacyBlockScreenshots: boolean | undefined }): SecuritySettings {
  if (input.stored && typeof input.stored === 'object') {
    return normalizeSecuritySettings(input.stored as { blockScreenshots?: unknown });
  }
  return normalizeSecuritySettings({ blockScreenshots: input.legacyBlockScreenshots });
}

function read(): SecuritySettings {
  try {
    const stored = mmkvGetObject<unknown>(SECURITY_SETTINGS_BACKUP_KEY);
    const legacy = mmkvGetBoolean(mmkvKeys.privacyBlockScreenshotsApp);
    const settings = securitySettingsFromStorage({ stored, legacyBlockScreenshots: legacy });
    if (stored == null && legacy !== undefined) {
      // Once: a phone that set it before backups carried it moves it to the backed-up key.
      mmkvSetObject(SECURITY_SETTINGS_BACKUP_KEY, securitySettingsBackupValue(settings));
    }
    return settings;
  } catch {
    return { ...DEFAULT_SECURITY_SETTINGS };
  }
}

const useSecuritySettingsStore = createStore<SecuritySettings>()(() => read());

export function useSecuritySettings(): SecuritySettings {
  return useSecuritySettingsStore((state) => state);
}

export function getSecuritySettings(): SecuritySettings {
  return useSecuritySettingsStore.getState();
}

export function setBlockScreenshots(on: boolean): void {
  try {
    mmkvSetObject(SECURITY_SETTINGS_BACKUP_KEY, securitySettingsBackupValue({ blockScreenshots: on }));
    mmkvSetBoolean(mmkvKeys.privacyBlockScreenshotsApp, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useSecuritySettingsStore.setState({ blockScreenshots: on });
}

/** Reloads from storage (a restored backup, tests). */
export function reloadSecuritySettings(): SecuritySettings {
  const next = read();
  useSecuritySettingsStore.setState(next, true);
  return next;
}
