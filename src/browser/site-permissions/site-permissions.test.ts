import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { parseBrowserChromeMessage } from '../bridge/browser-chrome.bridge.ts';
import { SITE_PERMISSION_PAGE_SCRIPT } from './site-permission-script.ts';
import {
  parseSitePermissions,
  popupsAllowedFor,
  recordBlocked,
  resetSite,
  serializeSitePermissions,
  setPopupsAllowed,
  sitePermissionList,
  SITE_PERMISSIONS_MAX_CHARS,
} from './site-permissions.ts';

describe('B13 site list (stored per profile as JSON)', () => {
  test('a request is listed as Blocked under its site, once', () => {
    let map = recordBlocked({}, 'maps.example.com', 'location', 1);
    map = recordBlocked(map, 'maps.example.com', 'camera', 2);
    map = recordBlocked(map, 'maps.example.com', 'location', 3);
    assert.deepEqual(map['maps.example.com'].blocked, ['location', 'camera']);
  });

  test('pop-ups: always for a site, off again; reset one site or all', () => {
    let map = setPopupsAllowed({}, 'a.test', true, 1);
    assert.equal(popupsAllowedFor(map, 'a.test'), true);
    assert.equal(popupsAllowedFor(map, 'b.test'), false);
    assert.equal(popupsAllowedFor(map, null), false);
    map = setPopupsAllowed(map, 'a.test', false, 2);
    assert.equal('a.test' in map, false);
    map = recordBlocked(setPopupsAllowed(map, 'b.test', true, 3), 'c.test', 'notifications', 4);
    assert.deepEqual(Object.keys(resetSite(map, 'b.test')), ['c.test']);
  });

  test('stored JSON is read by its fields; junk is dropped; it round-trips and stays under the backup cap', () => {
    const map = parseSitePermissions(
      JSON.stringify({
        'ok.test': { blocked: ['camera', 'nope', 'camera'], popupsAllowed: false, updatedAt: 5 },
        'BAD HOST': { blocked: ['camera'] },
        'empty.test': { blocked: [], popupsAllowed: false },
        'pop.test': { popupsAllowed: true },
      }),
    );
    assert.deepEqual(Object.keys(map).sort(), ['ok.test', 'pop.test']);
    assert.deepEqual(map['ok.test'].blocked, ['camera']);
    assert.deepEqual(parseSitePermissions(serializeSitePermissions(map)), map);
    assert.deepEqual(parseSitePermissions('not json'), {});
    let big = {};
    for (let i = 0; i < 400; i++) big = recordBlocked(big, `site-${i}.example.com`, 'location', i);
    const json = serializeSitePermissions(big);
    assert.ok(json.length <= SITE_PERMISSIONS_MAX_CHARS);
    assert.ok(Object.keys(JSON.parse(json)).includes('site-399.example.com'));
    assert.deepEqual(sitePermissionList(map).map((r) => r.site), ['ok.test', 'pop.test']);
  });
});

/** A page for the document-start script: geolocation, mediaDevices, window.open, user activation, a click listener. */
function fakePage(options: { notification?: boolean } = {}) {
  const posted: { type: string; payload: Record<string, unknown> }[] = [];
  const opened: unknown[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const activation = { isActive: false };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (raw: string) => posted.push(JSON.parse(raw)) },
    open: (...args: unknown[]) => {
      opened.push(args[0]);
      return { opened: true };
    },
  };
  if (options.notification) {
    window.Notification = function Notification() {};
  }
  const navigator = {
    userActivation: activation,
    geolocation: { getCurrentPosition: () => 'real', watchPosition: () => 7 },
    mediaDevices: { getUserMedia: () => Promise.resolve('stream') },
  };
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] ??= []).push(fn),
  };
  const context = vm.createContext({
    window,
    navigator,
    document,
    location: { href: 'https://site.test/page' },
    URL,
    Promise,
    setTimeout,
    JSON,
    Date,
    DOMException,
    Error,
    TypeError,
    String,
  });
  vm.runInContext(SITE_PERMISSION_PAGE_SCRIPT, context);
  return { context, window, navigator, posted, opened, listeners, activation };
}

describe('B13 page script (node:vm)', () => {
  test('location is refused with PERMISSION_DENIED and reported once', async () => {
    const page = fakePage();
    const errors: number[] = [];
    (page.navigator.geolocation.getCurrentPosition as (a: unknown, b: (e: { code: number }) => void) => void)(
      () => assert.fail('no position'),
      (e) => errors.push(e.code),
    );
    (page.navigator.geolocation.watchPosition as (a: unknown) => unknown)(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(errors, [1]);
    assert.deepEqual(
      page.posted.map((p) => [p.type, p.payload]),
      [['site_permission', { kind: 'location' }]],
    );
  });

  test('camera and microphone are refused with NotAllowedError', async () => {
    const page = fakePage();
    await assert.rejects(
      (page.navigator.mediaDevices.getUserMedia as (c: unknown) => Promise<unknown>)({ video: true, audio: true }),
      (error: Error) => error.name === 'NotAllowedError',
    );
    assert.deepEqual(page.posted.map((p) => p.payload.kind), ['camera', 'microphone']);
  });

  test('notifications: a "denied" stub where WebView has none; requestPermission resolves denied', async () => {
    const page = fakePage();
    const N = page.window.Notification as { permission: string; requestPermission: (cb?: (s: string) => void) => Promise<string> };
    assert.equal(N.permission, 'denied');
    assert.equal(await N.requestPermission(), 'denied');
    assert.deepEqual(page.posted.map((p) => p.payload.kind), ['notifications']);
    const withApi = fakePage({ notification: true });
    const M = withApi.window.Notification as { requestPermission: () => Promise<string> };
    assert.equal(await M.requestPermission(), 'denied');
  });

  test('#120 window.open without a tap is blocked and reported with its full address; with a tap it opens', () => {
    const page = fakePage();
    const open = page.window.open as (url?: string) => unknown;
    assert.equal(open('/ad?x=1'), null);
    assert.deepEqual(page.opened, []);
    assert.deepEqual(page.posted.at(-1)!.payload, { url: 'https://site.test/ad?x=1' });
    page.activation.isActive = true;
    assert.deepEqual(open('https://other.test/'), { opened: true });
    assert.deepEqual(page.opened, ['https://other.test/']);
  });

  test('a script-made click on a target=_blank link is stopped; a real tap is left alone', () => {
    const page = fakePage();
    const click = page.listeners.click[0];
    let prevented = 0;
    const link = { tagName: 'A', target: '_blank', href: 'https://pop.test/', parentElement: null };
    click({ isTrusted: false, target: link, preventDefault: () => (prevented += 1) });
    assert.equal(prevented, 1);
    assert.deepEqual(page.posted.at(-1)!.payload, { url: 'https://pop.test/' });
    click({ isTrusted: true, target: link, preventDefault: () => (prevented += 1) });
    click({ isTrusted: false, target: { ...link, target: '_self' }, preventDefault: () => (prevented += 1) });
    assert.equal(prevented, 1);
  });

  test('installs once, sends nothing from the app', () => {
    const page = fakePage();
    vm.runInContext(SITE_PERMISSION_PAGE_SCRIPT, page.context);
    assert.equal(page.listeners.click.length, 1);
    assert.doesNotMatch(SITE_PERMISSION_PAGE_SCRIPT, /localStorage|document\.cookie|fetch\(|XMLHttpRequest/);
  });
});

describe('B13 bridge messages', () => {
  const envelope = (type: string, payload: Record<string, unknown>) =>
    JSON.stringify({ channel: 'vidorax-browser-chrome', type, payload });

  test('site_permission: the four kinds only; popup_blocked: http(s) or null', () => {
    assert.deepEqual(parseBrowserChromeMessage(envelope('site_permission', { kind: 'camera' })), {
      type: 'site_permission',
      payload: { kind: 'camera' },
    });
    assert.equal(parseBrowserChromeMessage(envelope('site_permission', { kind: 'usb' })), null);
    assert.deepEqual(parseBrowserChromeMessage(envelope('popup_blocked', { url: 'https://a.test/x' })), {
      type: 'popup_blocked',
      payload: { url: 'https://a.test/x' },
    });
    assert.deepEqual(parseBrowserChromeMessage(envelope('popup_blocked', { url: 'javascript:alert(1)' })), {
      type: 'popup_blocked',
      payload: { url: null },
    });
  });
});
