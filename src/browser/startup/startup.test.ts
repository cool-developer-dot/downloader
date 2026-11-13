import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { escapePanels } from './escape-panels.ts';
import { cycleTabId, KEYBOARD_SHORTCUTS, shortcutActionFor, shortcutCombos } from './keyboard-shortcuts.ts';
import { SPELL_CHECK_OFF_PAGE_SCRIPT, spellCheckInputProps } from './spell-check.ts';
import {
  normalizeStartPageBackground,
  readStartPagePhoto,
  resolveStartPageBackground,
  START_PAGE_COLORS,
  START_PAGE_GRADIENTS,
} from './start-page-background.ts';
import {
  normalizeHomepageInput,
  normalizeStartupOption,
  planStartup,
  readHomepage,
  type StartupState,
} from './startup-settings.ts';
import {
  addToolbarButton,
  DEFAULT_TOOLBAR_BUTTONS_VALUE,
  MAX_TOOLBAR_BUTTONS,
  moveToolbarButton,
  parseToolbarButtons,
  removeToolbarButton,
  serializeToolbarButtons,
} from './toolbar-buttons.ts';

describe('B21 #232 homepage', () => {
  test('a site name or http(s) address becomes the homepage; empty is the start page', () => {
    assert.equal(normalizeHomepageInput('example.com'), 'https://example.com/');
    assert.equal(normalizeHomepageInput('  https://ur.wikipedia.org/wiki/صفحہ_اول '), 'https://ur.wikipedia.org/wiki/%D8%B5%D9%81%D8%AD%DB%81_%D8%A7%D9%88%D9%84');
    assert.equal(normalizeHomepageInput('http://news.ycombinator.com'), 'http://news.ycombinator.com/');
    assert.equal(normalizeHomepageInput('   '), '');
  });

  test('anything that is not a web page is refused', () => {
    for (const bad of ['javascript:alert(1)', 'file:///sdcard/x.html', 'intent://x', 'data:text/html,hi', 'two words', 'nodot', 'https://user:pw@example.com/', 'vidorax://home']) {
      assert.equal(normalizeHomepageInput(bad), null, bad);
    }
    assert.equal(normalizeHomepageInput(`https://e.com/${'a'.repeat(600)}`), null);
  });

  test('a stored value is checked again (backup, old value)', () => {
    assert.equal(readHomepage('https://example.com/'), 'https://example.com/');
    assert.equal(readHomepage('javascript:x'), '');
    assert.equal(readHomepage(42), '');
  });
});

describe('B21 #233 startup', () => {
  const base: StartupState = {
    activeIsStartPage: false,
    activeIsHomepage: false,
    tabCount: 3,
    maxTabs: 10,
    openedLaunchLink: false,
  };

  test('Continue where you left off (default) does nothing', () => {
    assert.equal(normalizeStartupOption(undefined), 'continue');
    assert.deepEqual(planStartup('continue', 'https://e.com/', base), { kind: 'none' });
  });

  test('Open the start page / the homepage put a new tab in front, keeping the others', () => {
    assert.deepEqual(planStartup('startPage', 'https://e.com/', base), { kind: 'newTab', url: null });
    assert.deepEqual(planStartup('homepage', 'https://e.com/', base), { kind: 'newTab', url: 'https://e.com/' });
    // No homepage set: the homepage is the start page.
    assert.deepEqual(planStartup('homepage', '', base), { kind: 'newTab', url: null });
  });

  test('a link from another app always wins', () => {
    assert.deepEqual(planStartup('startPage', '', { ...base, openedLaunchLink: true }), { kind: 'none' });
    assert.deepEqual(planStartup('homepage', 'https://e.com/', { ...base, openedLaunchLink: true }), { kind: 'none' });
  });

  test('no second start page or homepage in front, nothing at the tab limit', () => {
    assert.deepEqual(planStartup('startPage', '', { ...base, activeIsStartPage: true }), { kind: 'none' });
    assert.deepEqual(planStartup('homepage', 'https://e.com/', { ...base, activeIsHomepage: true }), { kind: 'none' });
    assert.deepEqual(planStartup('startPage', '', { ...base, tabCount: 10 }), { kind: 'none' });
  });
});

describe('B21 #238 toolbar', () => {
  test('default is today: Back, Forward, Home', () => {
    assert.equal(DEFAULT_TOOLBAR_BUTTONS_VALUE, 'back,forward,home');
    assert.deepEqual(parseToolbarButtons(undefined), ['back', 'forward', 'home']);
  });

  test('unknown or repeated buttons from old saves are skipped; nothing usable gives the default', () => {
    assert.deepEqual(parseToolbarButtons('home, ai ,back,back,tabs,menu,reload'), ['home', 'back', 'reload']);
    assert.deepEqual(parseToolbarButtons('ai,settings'), ['back', 'forward', 'home']);
    assert.deepEqual(parseToolbarButtons(''), ['back', 'forward', 'home']);
    assert.equal(serializeToolbarButtons(['reload', 'reload' as never, 'share']), 'reload,share');
  });

  test('add, remove, move; at most 6, at least 1', () => {
    let ids = parseToolbarButtons('back,forward,home');
    ids = addToolbarButton(ids, 'newTab');
    ids = addToolbarButton(ids, 'newTab');
    assert.deepEqual(ids, ['back', 'forward', 'home', 'newTab']);
    ids = moveToolbarButton(ids, 'newTab', -1);
    assert.deepEqual(ids, ['back', 'forward', 'newTab', 'home']);
    assert.deepEqual(moveToolbarButton(ids, 'back', -1), ids);
    ids = addToolbarButton(addToolbarButton(ids, 'share'), 'reload');
    assert.equal(ids.length, MAX_TOOLBAR_BUTTONS);
    assert.deepEqual(addToolbarButton(ids, 'history'), ids);
    assert.deepEqual(removeToolbarButton(['home'], 'home'), ['home']);
    assert.deepEqual(removeToolbarButton(ids, 'home'), ['back', 'forward', 'newTab', 'share', 'reload']);
    assert.deepEqual(parseToolbarButtons('back,forward,home,newTab,reload,share,history,bookmarks').length, 6);
  });
});

describe('B21 #246 keyboard shortcuts', () => {
  test('every shortcut on the card, with the channel names', () => {
    const combos = KEYBOARD_SHORTCUTS.flatMap((s) => s.combos);
    for (const combo of ['ctrl+t', 'ctrl+w', 'ctrl+shift+t', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+l', 'ctrl+r', 'f5', 'ctrl+shift+r', 'alt+left', 'alt+right', 'ctrl+d', 'ctrl+h', 'ctrl+f', 'escape']) {
      assert.ok(combos.includes(combo), combo);
    }
    assert.equal(new Set(combos).size, combos.length);
    assert.equal(shortcutActionFor('CTRL+T'), 'newTab');
    assert.equal(shortcutActionFor('f5'), 'reload');
    assert.equal(shortcutActionFor('ctrl+f'), 'findInPage');
    assert.equal(shortcutActionFor('ctrl+q'), null);
  });

  test('nothing is taken while the browser is not in front; Esc only while a panel is open', () => {
    assert.deepEqual(shortcutCombos({ browserInFront: false, panelOpen: true }), []);
    assert.ok(!shortcutCombos({ browserInFront: true, panelOpen: false }).includes('escape'));
    assert.ok(shortcutCombos({ browserInFront: true, panelOpen: true }).includes('escape'));
  });

  test('next / previous tab wrap around', () => {
    assert.equal(cycleTabId(['a', 'b', 'c'], 'c', 1), 'a');
    assert.equal(cycleTabId(['a', 'b', 'c'], 'a', -1), 'c');
    assert.equal(cycleTabId(['a'], 'a', 1), null);
  });

  test('Esc closes the newest open panel', () => {
    escapePanels.reset();
    const closed: string[] = [];
    const offA = escapePanels.open('addressBar', () => closed.push('addressBar'));
    escapePanels.open('find', () => closed.push('find'));
    assert.equal(escapePanels.isAnyOpen(), true);
    assert.equal(escapePanels.closeNewest(), true);
    assert.deepEqual(closed, ['find']);
    offA();
    assert.equal(escapePanels.isAnyOpen(), false);
    assert.equal(escapePanels.closeNewest(), false);
  });
});

describe('B21 #245 start page background', () => {
  test('theme by default; presets fall back to the first', () => {
    assert.equal(normalizeStartPageBackground('neon'), 'theme');
    assert.deepEqual(resolveStartPageBackground({ kind: 'color', color: 'nope', gradient: '', photo: '' }), {
      kind: 'color',
      color: START_PAGE_COLORS[0].color,
    });
    assert.deepEqual(resolveStartPageBackground({ kind: 'gradient', color: '', gradient: 'ember', photo: '' }), {
      kind: 'gradient',
      colors: START_PAGE_GRADIENTS[2].colors,
    });
  });

  test('only a photo in the app’s own start-page folder is shown', () => {
    const good = 'file:///data/user/0/com.vidorax.fast.videodownloader/files/start-page/background-1730000000000.jpg';
    assert.equal(readStartPagePhoto(good), good);
    for (const bad of [
      'file:///sdcard/DCIM/me.jpg',
      'https://example.com/start-page/background-1.jpg',
      'file:///data/x/start-page/../../secret/background-1.jpg',
      'content://media/external/images/1',
      '',
    ]) {
      assert.equal(readStartPagePhoto(bad), null, bad);
    }
    assert.deepEqual(resolveStartPageBackground({ kind: 'photo', color: '', gradient: '', photo: 'file:///sdcard/x.jpg' }), {
      kind: 'theme',
    });
  });
});

describe('B21 #237 spell check', () => {
  test('on changes nothing in app fields; off turns suggestions off', () => {
    assert.deepEqual(spellCheckInputProps(true), {});
    assert.deepEqual(spellCheckInputProps(false), { autoCorrect: false, spellCheck: false });
  });

  function page() {
    const attributes: Record<string, string> = {};
    const listeners: Record<string, ((event: unknown) => void)[]> = {};
    const root = { setAttribute: (k: string, v: string) => (attributes[k] = v) };
    const window: Record<string, unknown> = {};
    const document = {
      documentElement: root,
      addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] ??= []).push(fn),
    };
    const context = vm.createContext({ window, document });
    return { context, attributes, listeners };
  }

  test('the page script (node:vm) turns spell check off on the document and on focused fields, once', () => {
    const { context, attributes, listeners } = page();
    vm.runInContext(SPELL_CHECK_OFF_PAGE_SCRIPT, context);
    vm.runInContext(SPELL_CHECK_OFF_PAGE_SCRIPT, context);
    assert.equal(attributes.spellcheck, 'false');
    assert.equal(listeners.focusin.length, 1);
    const field: Record<string, string> & { tagName: string; setAttribute?: (k: string, v: string) => void } = { tagName: 'textarea' };
    field.setAttribute = (k, v) => (field[k] = v);
    listeners.focusin[0]({ target: field });
    assert.equal(field.spellcheck, 'false');
    assert.equal(field.autocorrect, 'off');
    const button: Record<string, string> & { tagName: string; setAttribute?: (k: string, v: string) => void } = { tagName: 'BUTTON' };
    button.setAttribute = (k, v) => (button[k] = v);
    listeners.focusin[0]({ target: button });
    assert.equal(button.spellcheck, undefined);
  });

  test('the page script reads and sends nothing', () => {
    assert.doesNotMatch(SPELL_CHECK_OFF_PAGE_SCRIPT, /postMessage|ReactNativeWebView|localStorage|cookie|fetch\(|XMLHttpRequest/);
  });
});
