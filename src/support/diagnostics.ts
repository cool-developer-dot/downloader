/**
 * Phase 4B.1 — Safe diagnostic collector.
 *
 * ALLOWLIST approach: only explicitly listed fields are included.
 * No tokens, passwords, paths, source URLs, API keys, or store snapshots.
 *
 * Excluded (explicit):
 *   - access token / refresh token
 *   - password / credentials
 *   - SecureStore contents
 *   - cookies / session secrets
 *   - raw media / source URLs
 *   - local / private filesystem paths
 *   - API secrets / env vars
 *   - database IDs
 *   - backend / internal topology
 *   - Zustand store snapshots
 *   - full request / response objects
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getAppIdentityMetadata } from '@/constants/app-identity';
import { getActiveLanguage } from '@/localization';
import { getThemeMode } from '@/storage/mmkv';

import type { ReportCategoryId, ReportDiagnostics } from './report-types';

/**
 * Resolves the Android OS version string safely.
 * Returns 'Unknown' rather than throwing.
 */
function resolveOsVersion(): string {
  if (Platform.OS === 'android') {
    const v = Device.osVersion;
    if (v && v.trim().length > 0) {
      return `Android ${v.trim()}`;
    }
    const api = Device.platformApiLevel;
    if (typeof api === 'number' && api > 0) {
      return `Android API ${api}`;
    }
    return 'Android';
  }
  const v = Device.osVersion;
  if (v && v.trim().length > 0) {
    return `${Platform.OS} ${v.trim()}`;
  }
  return Platform.OS;
}

/**
 * Resolves the device model string safely.
 * Returns 'Unknown' rather than throwing.
 */
function resolveDeviceModel(): string {
  const model = Device.modelName;
  if (model && model.trim().length > 0) {
    return model.trim();
  }
  return 'Unknown';
}

/**
 * Collects a safe diagnostic snapshot.
 * Call once per report — does not cache between reports.
 *
 * @param issueCategory - The selected report category, or null.
 */
export function collectDiagnostics(
  issueCategory: ReportCategoryId | null,
): ReportDiagnostics {
  const { version, build } = getAppIdentityMetadata();
  const locale = getActiveLanguage();

  return {
    appVersion: version,
    buildNumber: build,
    platform: Platform.OS,
    osVersion: resolveOsVersion(),
    deviceModel: resolveDeviceModel(),
    appLocale: locale,
    appTheme: getThemeMode(),
    issueCategory,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns a human-readable array of diagnostic lines for UI preview.
 * Safe to display — uses only allowlisted fields.
 */
export function formatDiagnosticsForDisplay(
  d: ReportDiagnostics,
): readonly string[] {
  const lines: string[] = [];
  if (d.appVersion && d.appVersion !== '—') {
    lines.push(`Version ${d.appVersion}`);
  }
  if (d.buildNumber && d.buildNumber !== '—') {
    lines.push(`Build ${d.buildNumber}`);
  }
  if (d.osVersion) {
    lines.push(d.osVersion);
  }
  if (d.deviceModel && d.deviceModel !== 'Unknown') {
    lines.push(`Device ${d.deviceModel}`);
  }
  if (d.appLocale) {
    lines.push(`Language ${d.appLocale}`);
  }
  return lines;
}

/**
 * Verifies no sensitive key names appear in a diagnostics object.
 * Used by tests and internal security checks only.
 */
export const DIAGNOSTICS_SENSITIVE_KEYS = [
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'secret',
  'cookie',
  'session',
  'credential',
  'apiKey',
  'authKey',
  'privateKey',
  'filePath',
  'sourcePath',
  'mediaUrl',
  'sourceUrl',
  'dbId',
  'userId',
  'internalUrl',
] as const;

export type DiagnosticsSensitiveKey =
  (typeof DIAGNOSTICS_SENSITIVE_KEYS)[number];

/**
 * Returns true if none of the known sensitive keys are present in the object.
 * Intentionally conservative — a false positive means "check this field".
 */
export function diagnosticsHasNoSensitiveKeys(
  obj: Record<string, unknown>,
): boolean {
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  return DIAGNOSTICS_SENSITIVE_KEYS.every(
    (s) => !keys.includes(s.toLowerCase()),
  );
}
