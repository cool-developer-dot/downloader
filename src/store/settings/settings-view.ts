/**
 * P8 #516 Beginner Mode / #517 Advanced Mode: "Settings view: Simple / Advanced". Simple hides the settings rows and
 * sections marked `advanced` (network options, connections, headers, user agent, retries and timeouts, scheduling
 * details, file naming templates…). Any package can mark its own rows: `<SettingsRow advanced …>`,
 * `<SettingsSection advanced …>` or `<AdvancedSetting>…</AdvancedSetting>`. Pure.
 */

export type SettingsView = 'simple' | 'advanced';

export const SETTINGS_VIEWS: readonly SettingsView[] = ['simple', 'advanced'];

/** New installs start in Simple. */
export const DEFAULT_SETTINGS_VIEW: SettingsView = 'simple';

export function isSettingsView(value: unknown): value is SettingsView {
  return value === 'simple' || value === 'advanced';
}

/**
 * The view after loading saved settings: a saved choice is kept; settings saved before 1.2.0 (no `settingsView`, but
 * other settings) are an existing install and keep every row they had — Advanced; nothing saved is a new install —
 * Simple.
 */
export function settingsViewMigration(persisted: Readonly<Record<string, unknown>>): SettingsView {
  if (isSettingsView(persisted.settingsView)) {
    return persisted.settingsView;
  }
  return Object.keys(persisted).length > 0 ? 'advanced' : DEFAULT_SETTINGS_VIEW;
}

/**
 * The view to save once at startup, or null when one is saved already. Zustand saves settings only when one changes,
 * so an install from before 1.2.0 whose settings were never touched has none saved at all; its finished intro still
 * marks it as an existing install (Advanced). Saving the choice keeps a new install that finishes the intro in Simple
 * on its next start.
 */
export function settingsViewToSave(storedSettings: string | null | undefined, onboardingComplete: boolean): SettingsView | null {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = storedSettings ? JSON.parse(storedSettings) : null;
    const state = parsed && typeof parsed === 'object' ? (parsed as { state?: unknown }).state ?? parsed : null;
    if (state && typeof state === 'object') saved = state as Record<string, unknown>;
  } catch {
    saved = {};
  }
  if (isSettingsView(saved.settingsView)) {
    return null;
  }
  return onboardingComplete || Object.keys(saved).length > 0 ? 'advanced' : DEFAULT_SETTINGS_VIEW;
}

/** Whether a row (or section) shows: rows not marked advanced always do. */
export function isSettingVisible(advanced: boolean | undefined, view: SettingsView): boolean {
  return advanced !== true || view === 'advanced';
}
