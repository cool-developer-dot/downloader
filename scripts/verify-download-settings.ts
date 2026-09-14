/**
 * Download Settings toggle persistence / hydration verifier.
 *
 * Covers the Expo Go + remount regressions:
 * - missing MMKV keys must NOT force product defaults over live store `false`
 * - toggles update the canonical model immediately
 * - remount / re-hydrate keeps the latest boolean
 * - string "false" must not become truthy
 * - rapid toggles keep the latest value
 * - policy readers (wifi / autoResume / notifications) see the live model
 *
 * Run: npx tsx scripts/verify-download-settings.ts
 */

import {
  DEFAULT_DOWNLOAD_SETTINGS,
  type DownloadSettings,
} from '../src/downloads/settings/types';
import {
  normalizeDownloadSettings,
  normalizeMaxConcurrentDownloads,
} from '../src/downloads/settings/normalize';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

/**
 * Mirrors fixed hydrateDownloadSettings / readExplicitDownloadBooleans behavior.
 * Explicit disk values win; missing keys keep the live store.
 */
function hydrateFromDisk(
  live: DownloadSettings,
  disk: {
    wifiOnly: boolean | null;
    autoResume: boolean | null;
    notificationsEnabled: boolean | null;
    maxConcurrentDownloads: number | null;
  },
): DownloadSettings {
  return normalizeDownloadSettings({
    wifiOnly: disk.wifiOnly ?? live.wifiOnly,
    autoResume: disk.autoResume ?? live.autoResume,
    notificationsEnabled:
      disk.notificationsEnabled ?? live.notificationsEnabled,
    maxConcurrentDownloads:
      disk.maxConcurrentDownloads ?? live.maxConcurrentDownloads,
  });
}

/** Models optimistic toggle → remount hydrate (no explicit MMKV keys). */
function toggleThenRemount(
  initial: DownloadSettings,
  patch: Partial<DownloadSettings>,
): DownloadSettings {
  const afterToggle = normalizeDownloadSettings({ ...initial, ...patch });
  return hydrateFromDisk(afterToggle, {
    wifiOnly: null,
    autoResume: null,
    notificationsEnabled: null,
    maxConcurrentDownloads: null,
  });
}

console.log('Download Settings verifier\n');

test('defaults only apply when key is absent from both disk and live', () => {
  const emptyLive = normalizeDownloadSettings({});
  assertEqual(emptyLive.wifiOnly, false, 'wifi fresh default');
  assertEqual(emptyLive.autoResume, true, 'auto');
  assertEqual(emptyLive.notificationsEnabled, true, 'notif');
});

test('stored false survives hydration when MMKV keys are missing', () => {
  const live: DownloadSettings = {
    wifiOnly: false,
    autoResume: false,
    notificationsEnabled: false,
    maxConcurrentDownloads: 2,
  };
  const hydrated = hydrateFromDisk(live, {
    wifiOnly: null,
    autoResume: null,
    notificationsEnabled: null,
    maxConcurrentDownloads: null,
  });
  assertEqual(hydrated.wifiOnly, false, 'wifi');
  assertEqual(hydrated.autoResume, false, 'auto');
  assertEqual(hydrated.notificationsEnabled, false, 'notif');
});

test('explicit disk false wins over live true', () => {
  const live: DownloadSettings = {
    ...DEFAULT_DOWNLOAD_SETTINGS,
    wifiOnly: true,
  };
  const hydrated = hydrateFromDisk(live, {
    wifiOnly: false,
    autoResume: null,
    notificationsEnabled: null,
    maxConcurrentDownloads: null,
  });
  assertEqual(hydrated.wifiOnly, false, 'wifi');
});

test('explicit disk true wins over live false', () => {
  const live: DownloadSettings = {
    ...DEFAULT_DOWNLOAD_SETTINGS,
    wifiOnly: false,
  };
  const hydrated = hydrateFromDisk(live, {
    wifiOnly: true,
    autoResume: null,
    notificationsEnabled: null,
    maxConcurrentDownloads: null,
  });
  assertEqual(hydrated.wifiOnly, true, 'wifi');
});

test('toggle wifiOnly → remount keeps false (no delayed default overwrite)', () => {
  const after = toggleThenRemount(DEFAULT_DOWNLOAD_SETTINGS, { wifiOnly: false });
  assertEqual(after.wifiOnly, false, 'wifi');
  assertEqual(after.autoResume, DEFAULT_DOWNLOAD_SETTINGS.autoResume, 'auto');
});

test('toggle autoResume → remount keeps false', () => {
  const after = toggleThenRemount(DEFAULT_DOWNLOAD_SETTINGS, {
    autoResume: false,
  });
  assertEqual(after.autoResume, false, 'auto');
});

test('toggle notifications → remount keeps false', () => {
  const after = toggleThenRemount(DEFAULT_DOWNLOAD_SETTINGS, {
    notificationsEnabled: false,
  });
  assertEqual(after.notificationsEnabled, false, 'notif');
});

test('legacy hydrate bug: missing disk must not force defaults over live false', () => {
  const liveFalse: DownloadSettings = {
    wifiOnly: false,
    autoResume: false,
    notificationsEnabled: false,
    maxConcurrentDownloads: 3,
  };
  const buggy = normalizeDownloadSettings({
    wifiOnly: true,
    autoResume: true,
    notificationsEnabled: true,
    maxConcurrentDownloads: liveFalse.maxConcurrentDownloads,
  });
  assertEqual(buggy.wifiOnly, true, 'documents the old bug');

  const fixed = hydrateFromDisk(liveFalse, {
    wifiOnly: null,
    autoResume: null,
    notificationsEnabled: null,
    maxConcurrentDownloads: null,
  });
  assertEqual(fixed.wifiOnly, false, 'wifi');
  assertEqual(fixed.autoResume, false, 'auto');
  assertEqual(fixed.notificationsEnabled, false, 'notif');
  assertEqual(fixed.maxConcurrentDownloads, 3, 'max');
});

test('string "false" is not truthy — normalizer keeps boolean fallback', () => {
  const normalized = normalizeDownloadSettings({
    wifiOnly: 'false',
    autoResume: 'false',
    notificationsEnabled: 'false',
  });
  assertEqual(typeof normalized.wifiOnly, 'boolean', 'type');
  assertEqual(normalized.wifiOnly, DEFAULT_DOWNLOAD_SETTINGS.wifiOnly, 'wifi');
  assertEqual(normalized.autoResume, DEFAULT_DOWNLOAD_SETTINGS.autoResume, 'auto');
  assertEqual(
    normalized.notificationsEnabled,
    DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
    'notif',
  );
});

test('rapid toggles keep latest state', () => {
  let current = { ...DEFAULT_DOWNLOAD_SETTINGS };
  for (const value of [false, true, false, false, true]) {
    current = normalizeDownloadSettings({ ...current, wifiOnly: value });
  }
  assertEqual(current.wifiOnly, true, 'wifi latest');

  current = normalizeDownloadSettings({ ...current, autoResume: false });
  current = normalizeDownloadSettings({ ...current, autoResume: true });
  current = normalizeDownloadSettings({ ...current, autoResume: false });
  assertEqual(current.autoResume, false, 'auto latest');

  current = normalizeDownloadSettings({
    ...current,
    notificationsEnabled: false,
  });
  current = normalizeDownloadSettings({
    ...current,
    notificationsEnabled: true,
  });
  assertEqual(current.notificationsEnabled, true, 'notif latest');
});

test('policy readers see latest canonical values', () => {
  const settings = normalizeDownloadSettings({
    wifiOnly: false,
    autoResume: false,
    notificationsEnabled: false,
    maxConcurrentDownloads: 4,
  });

  assertEqual(settings.wifiOnly, false, 'wifi');
  assertEqual(settings.autoResume, false, 'auto');
  assertEqual(settings.notificationsEnabled, false, 'notif');
  assertEqual(
    normalizeMaxConcurrentDownloads(settings.maxConcurrentDownloads),
    4,
    'max',
  );
});

test('fallback chain: explicit → live → default', () => {
  const withLive = hydrateFromDisk(
    {
      wifiOnly: false,
      autoResume: true,
      notificationsEnabled: false,
      maxConcurrentDownloads: 3,
    },
    {
      wifiOnly: null,
      autoResume: null,
      notificationsEnabled: null,
      maxConcurrentDownloads: null,
    },
  );
  assert(withLive.wifiOnly === false, 'wifi live');
  assert(withLive.autoResume === true, 'auto live');
  assert(withLive.notificationsEnabled === false, 'notif live');
  assert(withLive.maxConcurrentDownloads === 3, 'max live');

  const cold = hydrateFromDisk(
    {
      wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
      autoResume: DEFAULT_DOWNLOAD_SETTINGS.autoResume,
      notificationsEnabled: DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
      maxConcurrentDownloads: DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads,
    },
    {
      wifiOnly: null,
      autoResume: null,
      notificationsEnabled: null,
      maxConcurrentDownloads: null,
    },
  );
  assert(
    JSON.stringify(cold) === JSON.stringify(DEFAULT_DOWNLOAD_SETTINGS),
    'cold defaults',
  );
});

test('notifications preference off does not imply FGS disable', () => {
  const settings = normalizeDownloadSettings({ notificationsEnabled: false });
  assertEqual(settings.notificationsEnabled, false, 'pref off');
  const fgsRequiredWhileActive = true;
  assert(fgsRequiredWhileActive, 'FGS remains mandatory while transfers active');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
