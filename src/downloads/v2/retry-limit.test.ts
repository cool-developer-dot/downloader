import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import {
  AUTOMATIC_RETRY_LIMIT,
  clampRetryLimit,
  DEFAULT_NETWORK_OPTIONS,
  isDefaultNetworkOptions,
  MAX_RETRY_LIMIT,
  MIN_RETRY_LIMIT,
  networkSettingsFields,
  normalizeRetryLimit,
  RETRY_LIMIT_CHOICES,
  sameNetworkFields,
  type NetworkOptionsInput,
} from './network-options';
import {
  getNetworkOptionsInput,
  setNetworkHeadersStorageForTests,
  subscribeNetworkOptions,
  useNetworkOptionsStore,
} from './network-options-store';
import { pushV2DownloadSettings, resetV2SettingsForTests, sameV2Settings, v2DownloadSettings } from './settings';

const BASE = { wifiOnly: false, maxConcurrentDownloads: 2, saveToGallery: true };

function options(overrides: Partial<NetworkOptionsInput>): NetworkOptionsInput {
  return { ...DEFAULT_NETWORK_OPTIONS, ...overrides };
}

function recordingEngine() {
  const sent: DownloadSettings[] = [];
  const engine = { setDownloadSettings: async (settings: DownloadSettings) => void sent.push(settings) } as unknown as V2EnginePort;
  return { sent, engine };
}

describe('#332 retry limit: Automatic is today', () => {
  beforeEach(() => resetV2SettingsForTests());
  afterEach(() => resetV2SettingsForTests());

  test('the choices are Automatic (5), 1, 3, 5 and 10; Automatic is the default', () => {
    assert.deepEqual(RETRY_LIMIT_CHOICES, ['automatic', '1', '3', '5', '10']);
    assert.equal(DEFAULT_NETWORK_OPTIONS.retryLimit, 'automatic');
    assert.equal(AUTOMATIC_RETRY_LIMIT, 5);
    assert.equal(isDefaultNetworkOptions(DEFAULT_NETWORK_OPTIONS), true);
  });

  test('Automatic, or options without the field, send nothing new', () => {
    const before = v2DownloadSettings(BASE);
    assert.equal('retryLimit' in before, false);
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: options({ retryLimit: 'automatic' }) }), before);
    const older: NetworkOptionsInput = { userAgentMode: 'automatic', customUserAgent: '', headers: [], timeout: 'automatic' };
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: older }), before);
    assert.deepEqual(networkSettingsFields(older), {});
  });

  test('a chosen limit is sent as a number, only then', () => {
    for (const choice of ['1', '3', '5', '10'] as const) {
      const settings = v2DownloadSettings({ ...BASE, network: options({ retryLimit: choice }) });
      assert.equal(settings.retryLimit, Number(choice));
      assert.deepEqual(networkSettingsFields(options({ retryLimit: choice })), { retryLimit: Number(choice) });
    }
    assert.equal(isDefaultNetworkOptions(options({ retryLimit: '3' })), false);
  });

  test('changing the limit, or going back to Automatic, is pushed; the same limit twice is not', async () => {
    const { sent, engine } = recordingEngine();
    await pushV2DownloadSettings(engine, { ...BASE, network: options({ retryLimit: '3' }) });
    await pushV2DownloadSettings(engine, { ...BASE, network: options({ retryLimit: '3' }) });
    await pushV2DownloadSettings(engine, { ...BASE, network: options({ retryLimit: '10' }) });
    await pushV2DownloadSettings(engine, { ...BASE, network: options({ retryLimit: 'automatic' }) });
    assert.deepEqual(
      sent.map((settings) => settings.retryLimit),
      [3, 10, undefined],
    );
    assert.equal('retryLimit' in sent[2]!, false);
    assert.equal(sameNetworkFields({ retryLimit: 3 }, { retryLimit: 3 }), true);
    assert.equal(sameNetworkFields({ retryLimit: 3 }, {}), false);
    assert.equal(
      sameV2Settings(v2DownloadSettings(BASE), v2DownloadSettings({ ...BASE, network: options({ retryLimit: '1' }) })),
      false,
    );
  });
});

describe('#332 retry limit: values', () => {
  test('a number is clamped to 1..10; anything else is Automatic', () => {
    assert.equal(clampRetryLimit('1'), 1);
    assert.equal(clampRetryLimit(10), 10);
    assert.equal(clampRetryLimit(0), MIN_RETRY_LIMIT);
    assert.equal(clampRetryLimit(-5), MIN_RETRY_LIMIT);
    assert.equal(clampRetryLimit(99), MAX_RETRY_LIMIT);
    assert.equal(clampRetryLimit(2.6), 3);
    assert.equal(clampRetryLimit('automatic'), null);
    assert.equal(clampRetryLimit(Number.NaN), null);
    assert.equal(clampRetryLimit(undefined), null);
  });

  test('a stored choice is re-validated; an unknown one is Automatic', () => {
    assert.equal(normalizeRetryLimit({ retryLimit: '10' }), '10');
    assert.equal(normalizeRetryLimit({ retryLimit: '7' }), 'automatic');
    assert.equal(normalizeRetryLimit({ retryLimit: 3 }), 'automatic');
    assert.equal(normalizeRetryLimit({}), 'automatic');
    assert.equal(normalizeRetryLimit(null), 'automatic');
    assert.equal(normalizeRetryLimit(['10']), 'automatic');
  });
});

describe('#332 retry limit: the store', () => {
  beforeEach(() => {
    setNetworkHeadersStorageForTests({ read: async () => null, write: async () => {}, remove: async () => {} });
    useNetworkOptionsStore.setState({ ...DEFAULT_NETWORK_OPTIONS, headersHydrated: true });
  });
  afterEach(() => setNetworkHeadersStorageForTests(null));

  test('the choice is part of what the settings push sends', () => {
    useNetworkOptionsStore.getState().setRetryLimit('10');
    assert.equal(getNetworkOptionsInput().retryLimit, '10');
    useNetworkOptionsStore.getState().reset();
    assert.equal(getNetworkOptionsInput().retryLimit, 'automatic');
  });

  test('a change notifies the push once; choosing the same value again does not', () => {
    let pushes = 0;
    const detach = subscribeNetworkOptions(() => {
      pushes += 1;
    });
    try {
      useNetworkOptionsStore.getState().setRetryLimit('3');
      useNetworkOptionsStore.getState().setRetryLimit('3');
      assert.equal(pushes, 1);
      useNetworkOptionsStore.getState().setRetryLimit('automatic');
      assert.equal(pushes, 2);
    } finally {
      detach();
    }
  });
});
