/**
 * Reset Settings (#470): every `SettingsState` value back to its default, except the ones the user keeps across a
 * reset. The language is kept — and with it the RTL layout, which follows the language — so a reset never switches
 * the app's language or direction. Pure.
 */

/** Settings a reset leaves as they are. */
export const RESET_KEEPS: readonly string[] = ['language'];

/**
 * Pure: the `[key, default]` pairs a reset writes — every default except the kept keys. All of them are written
 * (not only the ones that differ), so the preference mirrors end up exactly as a full reset would leave them.
 */
export function settingsResetEntries(
  defaults: Readonly<Record<string, unknown>>,
  keep: readonly string[] = RESET_KEEPS,
): [string, unknown][] {
  return Object.keys(defaults)
    .filter((key) => !keep.includes(key))
    .map((key) => [key, defaults[key]]);
}

/** Pure: what the settings are after a reset of `current`. */
export function resetSettingsState<T extends Record<string, unknown>>(
  current: T,
  defaults: Readonly<Record<string, unknown>>,
  keep: readonly string[] = RESET_KEEPS,
): T {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of settingsResetEntries(defaults, keep)) {
    next[key] = value;
  }
  return next as T;
}
