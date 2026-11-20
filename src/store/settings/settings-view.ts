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

/** Whether a row (or section) shows: rows not marked advanced always do. */
export function isSettingVisible(advanced: boolean | undefined, view: SettingsView): boolean {
  return advanced !== true || view === 'advanced';
}
