/**
 * Files F10 · design 64 Security: what the page shows, and its one new stored setting.
 *
 * - App lock and Lock after are App Lock's own (setup / disable flows). App Lock locks the moment VidoraX leaves the
 *   screen (#917 Auto lock), so Lock after reads "Immediately"; there are no other choices.
 * - Block screenshots (#916) is new: the whole app, default off, kept in MMKV
 *   (`vidorax.mmkv.privacy.blockScreenshotsApp.v1`). Private keeps its own switch (Settings → Privacy).
 * - File encryption (#909), Hide history and Malware warning are protections VidoraX never turns off: Private files are
 *   always encrypted (AES-256-GCM, no unencrypted mode), a file moved into Private always leaves every history, and P8
 *   always warns before a file that isn't what its name says is opened. Their switches show On and can't be changed.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export type SecuritySettings = { blockScreenshots: boolean };

export const DEFAULT_SECURITY_SETTINGS: Readonly<SecuritySettings> = { blockScreenshots: false };

/** The protections shown as switches that are always on. */
export const ALWAYS_ON_PROTECTIONS = ['fileEncryption', 'hideHistory', 'malwareWarning'] as const;
export type AlwaysOnProtection = (typeof ALWAYS_ON_PROTECTIONS)[number];

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

function read(): SecuritySettings {
  try {
    return normalizeSecuritySettings({ blockScreenshots: mmkvGetBoolean(mmkvKeys.privacyBlockScreenshotsApp) });
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
