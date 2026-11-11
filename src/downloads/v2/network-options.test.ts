import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import {
  addHeaderProblem,
  clampTimeoutSeconds,
  DEFAULT_NETWORK_OPTIONS,
  headerNameProblem,
  headerValueProblem,
  isDefaultNetworkOptions,
  MAX_HEADER_NAME_LENGTH,
  MAX_HEADER_VALUE_LENGTH,
  MAX_HEADERS,
  MAX_TIMEOUT_SECONDS,
  MAX_USER_AGENT_LENGTH,
  MIN_TIMEOUT_SECONDS,
  networkSettingsFields,
  normalizeHeaders,
  normalizeNetworkOptions,
  sameNetworkFields,
  validateUserAgent,
  type NetworkOptionsInput,
} from './network-options';
import { pushV2DownloadSettings, resetV2SettingsForTests, sameV2Settings, v2DownloadSettings } from './settings';

const BASE = { wifiOnly: false, maxConcurrentDownloads: 2, saveToGallery: true };

function options(overrides: Partial<NetworkOptionsInput>): NetworkOptionsInput {
  return { ...DEFAULT_NETWORK_OPTIONS, ...overrides };
}

describe('untouched settings send nothing new to native', () => {
  test('no network options, or the defaults, give exactly the settings sent before', () => {
    const before = v2DownloadSettings(BASE);
    assert.deepEqual(Object.keys(before).sort(), ['autoSaveToGallery', 'maxConcurrent', 'preferredMaxHeight', 'wifiOnly']);
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: DEFAULT_NETWORK_OPTIONS }), before);
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: null }), before);
    assert.equal(isDefaultNetworkOptions(DEFAULT_NETWORK_OPTIONS), true);
  });

  test('a "Custom" choice without a valid value is still today\'s behaviour', () => {
    const before = v2DownloadSettings(BASE);
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: options({ userAgentMode: 'custom', customUserAgent: '' }) }), before);
    assert.deepEqual(
      v2DownloadSettings({ ...BASE, network: options({ userAgentMode: 'custom', customUserAgent: 'bad\nagent' }) }),
      before,
    );
    // A custom value kept while Automatic is chosen is not sent.
    assert.deepEqual(v2DownloadSettings({ ...BASE, network: options({ customUserAgent: 'Kept/1.0' }) }), before);
  });

  test('the push sends the same object as before and skips it when nothing changed', async () => {
    resetV2SettingsForTests();
    const sent: DownloadSettings[] = [];
    const engine = { setDownloadSettings: async (settings: DownloadSettings) => void sent.push(settings) } as unknown as V2EnginePort;
    await pushV2DownloadSettings(engine, { ...BASE, network: DEFAULT_NETWORK_OPTIONS });
    await pushV2DownloadSettings(engine, { ...BASE, network: DEFAULT_NETWORK_OPTIONS });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { maxConcurrent: 2, wifiOnly: false, autoSaveToGallery: true, preferredMaxHeight: null });
    resetV2SettingsForTests();
  });
});

describe('changed options reach native', () => {
  beforeEach(() => resetV2SettingsForTests());

  test('only the fields that changed are added', () => {
    const settings = v2DownloadSettings({
      ...BASE,
      network: options({
        userAgentMode: 'custom',
        customUserAgent: '  Custom/2.0  ',
        headers: [{ name: 'X-Api-Key', value: 'k' }],
        timeout: '60',
      }),
    });
    assert.equal(settings.userAgent, 'Custom/2.0');
    assert.deepEqual(settings.customHeaders, { 'X-Api-Key': 'k' });
    assert.equal(settings.connectTimeoutSeconds, 60);
    assert.equal(settings.readTimeoutSeconds, 60);
    assert.deepEqual(networkSettingsFields(options({ timeout: '15' })), { connectTimeoutSeconds: 15, readTimeoutSeconds: 15 });
  });

  test('a change in any network field is a change to push; going back to Automatic is too', async () => {
    const plain = v2DownloadSettings(BASE);
    const agent = v2DownloadSettings({ ...BASE, network: options({ userAgentMode: 'custom', customUserAgent: 'A/1' }) });
    const otherAgent = v2DownloadSettings({ ...BASE, network: options({ userAgentMode: 'custom', customUserAgent: 'B/1' }) });
    const header = v2DownloadSettings({ ...BASE, network: options({ headers: [{ name: 'X-A', value: '1' }] }) });
    const otherHeader = v2DownloadSettings({ ...BASE, network: options({ headers: [{ name: 'X-A', value: '2' }] }) });
    assert.equal(sameV2Settings(plain, agent), false);
    assert.equal(sameV2Settings(agent, otherAgent), false);
    assert.equal(sameV2Settings(header, otherHeader), false);
    assert.equal(sameV2Settings(header, header), true);
    assert.equal(sameNetworkFields({ customHeaders: { a: '1' } }, { customHeaders: { a: '1', b: '2' } }), false);

    const sent: DownloadSettings[] = [];
    const engine = { setDownloadSettings: async (settings: DownloadSettings) => void sent.push(settings) } as unknown as V2EnginePort;
    await pushV2DownloadSettings(engine, { ...BASE, network: options({ userAgentMode: 'custom', customUserAgent: 'A/1' }) });
    await pushV2DownloadSettings(engine, { ...BASE, network: DEFAULT_NETWORK_OPTIONS });
    assert.equal(sent.length, 2);
    assert.equal('userAgent' in sent[1]!, false);
  });
});

describe('header validation', () => {
  test('the names that change what a request is are refused, in any case', () => {
    for (const name of [
      'Cookie',
      'Authorization',
      'Host',
      'Content-Length',
      'Range',
      'If-Range',
      'Connection',
      'Transfer-Encoding',
      'TE',
      'Upgrade',
      'Proxy-Authorization',
      'Proxy-Connection',
      'Sec-Fetch-Mode',
      'sec-ch-ua',
      'COOKIE',
      'authorization',
      'Accept-Encoding',
      'User-Agent',
      'X-Vidorax-Session',
    ]) {
      assert.equal(headerNameProblem(name), 'refused-name', name);
    }
    assert.equal(headerNameProblem('X-Requested-With'), null);
    assert.equal(headerNameProblem('Referer'), null);
  });

  test('line breaks are refused in names and values', () => {
    assert.equal(headerNameProblem('X-A\r\nCookie'), 'line-break');
    assert.equal(headerValueProblem('a\r\nCookie: x'), 'line-break');
    assert.equal(headerValueProblem('a\nb'), 'line-break');
    assert.equal(headerValueProblem('a\u2028b'), 'line-break');
  });

  test('names must be HTTP tokens; values visible ASCII', () => {
    assert.equal(headerNameProblem(''), 'empty-name');
    assert.equal(headerNameProblem('Bad Name'), 'invalid-name');
    assert.equal(headerNameProblem('X:Y'), 'invalid-name');
    assert.equal(headerNameProblem('ہیڈر'), 'invalid-name');
    assert.equal(headerValueProblem(''), 'empty-value');
    assert.equal(headerValueProblem('ویڈیو'), 'not-ascii');
    assert.equal(headerValueProblem('token 123 ;=/'), null);
  });

  test('lengths and the count are capped; duplicates (any case) are refused', () => {
    assert.equal(headerNameProblem(`X-${'a'.repeat(MAX_HEADER_NAME_LENGTH)}`), 'name-too-long');
    assert.equal(headerValueProblem('v'.repeat(MAX_HEADER_VALUE_LENGTH + 1)), 'value-too-long');
    assert.equal(headerValueProblem('v'.repeat(MAX_HEADER_VALUE_LENGTH)), null);
    const full = Array.from({ length: MAX_HEADERS }, (_, i) => ({ name: `X-H${i}`, value: 'v' }));
    assert.equal(addHeaderProblem(full, { name: 'X-New', value: 'v' }), 'too-many');
    assert.equal(addHeaderProblem(full.slice(0, 2), { name: 'x-h1', value: 'v' }), 'duplicate');
    assert.equal(addHeaderProblem([], { name: ' X-Ok ', value: ' v ' }), null);
  });

  test('stored headers are re-validated: only valid, unique pairs survive, at most the cap', () => {
    const stored = [
      { name: 'X-A', value: '1' },
      { name: 'Cookie', value: 'sid=1' },
      { name: 'x-a', value: 'dup' },
      { name: 'X-B', value: 'a\r\nb' },
      'junk',
      null,
      { name: 3, value: 'x' },
      ...Array.from({ length: 20 }, (_, i) => ({ name: `X-N${i}`, value: 'v' })),
    ];
    const headers = normalizeHeaders(stored);
    assert.equal(headers.length, MAX_HEADERS);
    assert.deepEqual(headers[0], { name: 'X-A', value: '1' });
    assert.equal(headers.some((header) => header.name.toLowerCase() === 'cookie'), false);
    assert.deepEqual(normalizeHeaders('nope'), []);
    // Only valid headers are ever sent, even if the list given to the push was not checked.
    assert.deepEqual(networkSettingsFields(options({ headers: [{ name: 'Host', value: 'evil' }] })), {});
  });
});

describe('User-Agent validation', () => {
  test('trimmed, one line, visible ASCII, capped', () => {
    assert.deepEqual(validateUserAgent('  Mozilla/5.0 (Linux; Android 14)  '), { ok: true, value: 'Mozilla/5.0 (Linux; Android 14)' });
    assert.deepEqual(validateUserAgent('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(validateUserAgent('A/1\r\nCookie: x'), { ok: false, reason: 'line-break' });
    assert.deepEqual(validateUserAgent('ویڈیو/1'), { ok: false, reason: 'not-ascii' });
    assert.deepEqual(validateUserAgent('a'.repeat(MAX_USER_AGENT_LENGTH + 1)), { ok: false, reason: 'too-long' });
    assert.equal(validateUserAgent('a'.repeat(MAX_USER_AGENT_LENGTH)).ok, true);
  });
});

describe('clamping', () => {
  test('timeouts are clamped to the safe range and rounded; non-numbers mean today\'s timeouts', () => {
    assert.equal(clampTimeoutSeconds(1), MIN_TIMEOUT_SECONDS);
    assert.equal(clampTimeoutSeconds(10_000), MAX_TIMEOUT_SECONDS);
    assert.equal(clampTimeoutSeconds('45.6'), 46);
    assert.equal(clampTimeoutSeconds(Number.NaN), null);
    assert.equal(clampTimeoutSeconds('soon'), null);
    assert.equal(clampTimeoutSeconds(undefined), null);
  });

  test('stored choices are validated; anything unknown is Automatic', () => {
    assert.deepEqual(normalizeNetworkOptions(undefined), { userAgentMode: 'automatic', customUserAgent: '', timeout: 'automatic' });
    assert.deepEqual(normalizeNetworkOptions({ userAgentMode: 'custom', customUserAgent: 'A/1', timeout: '60' }), {
      userAgentMode: 'custom',
      customUserAgent: 'A/1',
      timeout: '60',
    });
    assert.equal(normalizeNetworkOptions({ timeout: '5' }).timeout, 'automatic');
    assert.equal(normalizeNetworkOptions({ userAgentMode: 'custom', customUserAgent: 'x\ny' }).userAgentMode, 'automatic');
  });
});
