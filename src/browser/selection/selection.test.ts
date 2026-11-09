import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { handleSelectionAction, type SelectionActionPorts } from './selection-actions.ts';
import { buildSelectionMenu, SELECTION_MENU_ITEMS, type SelectionMenuItemDefinition } from './selection-menu-items.ts';
import { SELECTION_READ_SCRIPT, SELECTION_TEXT_MAX } from './selection-read-script.ts';
import { prepareSelectionSearch, SELECTION_SEARCH_MAX } from './selection-search.ts';

type FakeElement = { tagName: string; type?: string; value?: string; selectionStart?: unknown; selectionEnd?: unknown };

/** Runs the read script in a fresh page context, like WebView.evaluateJavascript, and returns its result. */
function runReadScript(page: { activeElement?: FakeElement | null; selection?: string; getSelection?: unknown }): unknown {
  const window: Record<string, unknown> = {
    getSelection:
      page.getSelection !== undefined ? page.getSelection : () => ({ toString: () => page.selection ?? '' }),
  };
  const context = vm.createContext({ window, document: { activeElement: page.activeElement ?? null } });
  return vm.runInContext(SELECTION_READ_SCRIPT, context);
}

describe('B8 read script (in a node:vm page)', () => {
  test('returns the page selection as a string', () => {
    assert.equal(runReadScript({ selection: 'Lahore is the capital of Punjab' }), 'Lahore is the capital of Punjab');
    assert.equal(runReadScript({ selection: 'لاہور پنجاب کا دارالحکومت ہے' }), 'لاہور پنجاب کا دارالحکومت ہے');
  });

  test('reads a selection inside a text field from the field', () => {
    const textarea = { tagName: 'TEXTAREA', value: 'hello wide world', selectionStart: 6, selectionEnd: 10 };
    assert.equal(runReadScript({ activeElement: textarea, selection: '' }), 'wide');
    const search = { tagName: 'INPUT', type: 'search', value: 'cats and dogs', selectionStart: 0, selectionEnd: 4 };
    assert.equal(runReadScript({ activeElement: search }), 'cats');
  });

  test('never reads a password field (or other input types) from the field', () => {
    const password = { tagName: 'INPUT', type: 'password', value: 'hunter2', selectionStart: 0, selectionEnd: 7 };
    assert.equal(runReadScript({ activeElement: password, selection: '' }), '');
    const email = { tagName: 'INPUT', type: 'email', value: 'a@b.c', selectionStart: 0, selectionEnd: 5 };
    assert.equal(runReadScript({ activeElement: email, selection: '' }), '');
  });

  test('falls back to the page selection when the field has none, and survives a broken page', () => {
    const field = { tagName: 'INPUT', type: 'text', value: 'x', selectionStart: 1, selectionEnd: 1 };
    assert.equal(runReadScript({ activeElement: field, selection: 'outside' }), 'outside');
    const throwing = {
      tagName: 'INPUT',
      type: 'text',
      get selectionStart(): number {
        throw new Error('InvalidStateError');
      },
    } as unknown as FakeElement;
    assert.equal(runReadScript({ activeElement: throwing, selection: 'still here' }), 'still here');
    assert.equal(
      runReadScript({
        getSelection: () => {
          throw new Error('boom');
        },
      }),
      '',
    );
    assert.equal(runReadScript({ getSelection: null }), '');
  });

  test('caps the text at 20,000 characters', () => {
    const long = 'a'.repeat(SELECTION_TEXT_MAX + 500);
    assert.equal((runReadScript({ selection: long }) as string).length, SELECTION_TEXT_MAX);
  });

  test('puts nothing from the app into the page', () => {
    assert.doesNotMatch(SELECTION_READ_SCRIPT, /postMessage|ReactNativeWebView|localStorage|document\.cookie|fetch\(/);
  });
});

describe('B8 #72 search text', () => {
  test('collapses whitespace and keeps short text whole', () => {
    assert.deepEqual(prepareSelectionSearch('  Lahore\n\n  Fort \t '), { query: 'Lahore Fort', truncated: false });
    assert.equal(prepareSelectionSearch(' \n\t '), null);
    assert.equal(prepareSelectionSearch(''), null);
  });

  test('cuts text over 300 characters at a word, with a note', () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const result = prepareSelectionSearch(words)!;
    assert.equal(result.truncated, true);
    assert.ok(result.query.length <= SELECTION_SEARCH_MAX);
    assert.ok(words.startsWith(result.query));
    assert.match(result.query, /word\d+$/);
  });

  test('a 2,000-character selection becomes a 300-character search', () => {
    const urdu = 'پاکستان '.repeat(250); // 2,000 characters
    assert.equal(urdu.length, 2000);
    const result = prepareSelectionSearch(urdu)!;
    assert.equal(result.truncated, true);
    assert.ok(result.query.length <= 300 && result.query.length > 250);
    assert.ok(result.query.endsWith('پاکستان'));
  });

  test('hard-cuts text without spaces, never splitting a surrogate pair', () => {
    const plain = prepareSelectionSearch('x'.repeat(400))!;
    assert.equal(plain.query.length, 300);
    const emoji = '\u{1F600}';
    const text = 'x'.repeat(299) + emoji + 'y';
    const cut = prepareSelectionSearch(text)!;
    assert.equal(cut.query, 'x'.repeat(299));
  });
});

describe('B8 menu items', () => {
  test('Search and (B22) Save to notes are the app items, titled in the app language', () => {
    assert.deepEqual(
      SELECTION_MENU_ITEMS.map((item) => item.id),
      ['search', 'save_note'],
    );
    assert.deepEqual(buildSelectionMenu(SELECTION_MENU_ITEMS, (key) => (key === 'browserSelection.search' ? 'تلاش' : 'نوٹ')), {
      ids: ['search', 'save_note'],
      titles: ['تلاش', 'نوٹ'],
    });
  });

  test('B22 Save to notes hands the selected text and its view over; nothing for empty text', () => {
    const saved: [string, number][] = [];
    const ports = {
      buildSearchUrl: (q: string) => q,
      openTabAfterCurrent: () => true,
      notifyTruncated: () => undefined,
      saveNote: (text: string, viewTag: number) => void saved.push([text, viewTag]),
    };
    assert.equal(handleSelectionAction({ viewTag: 7, itemId: 'save_note', text: '  Badshahi Mosque  ' }, ports), 'savedNote');
    assert.equal(handleSelectionAction({ viewTag: 7, itemId: 'save_note', text: '   ' }, ports), 'ignored');
    assert.deepEqual(saved, [['Badshahi Mosque', 7]]);
  });

  test('an empty title is left out, long titles are cut, at most 4 items', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `item${i}`, labelKey: 'browserSelection.search' }));
    const built = buildSelectionMenu(many as unknown as SelectionMenuItemDefinition[], () => 'x'.repeat(60));
    assert.equal(built.ids.length, 4);
    assert.equal(built.titles[0].length, 40);
    assert.deepEqual(buildSelectionMenu(SELECTION_MENU_ITEMS, () => '  '), { ids: [], titles: [] });
  });
});

describe('B8 actions', () => {
  function ports(opened = true) {
    const calls: { opened: { url: string; title: string }[]; truncatedNotes: number } = { opened: [], truncatedNotes: 0 };
    const value: SelectionActionPorts = {
      buildSearchUrl: (query) => `https://engine.test/search?q=${encodeURIComponent(query)}`,
      openTabAfterCurrent: (url, title) => {
        calls.opened.push({ url, title });
        return opened;
      },
      notifyTruncated: () => {
        calls.truncatedNotes += 1;
      },
    };
    return { value, calls };
  }

  test('Search opens the chosen engine in a new tab', () => {
    const { value, calls } = ports();
    assert.equal(handleSelectionAction({ viewTag: 3, itemId: 'search', text: 'Badshahi  Mosque' }, value), 'searched');
    assert.deepEqual(calls.opened, [
      { url: 'https://engine.test/search?q=Badshahi%20Mosque', title: 'Badshahi Mosque' },
    ]);
    assert.equal(calls.truncatedNotes, 0);
  });

  test('long text is searched cut, with the note', () => {
    const { value, calls } = ports();
    assert.equal(handleSelectionAction({ viewTag: 3, itemId: 'search', text: 'z'.repeat(2000) }, value), 'searchedTruncated');
    assert.equal(calls.truncatedNotes, 1);
    assert.equal(decodeURIComponent(calls.opened[0].url.split('q=')[1]).length, 300);
  });

  test('at the tab limit nothing else happens', () => {
    const { value, calls } = ports(false);
    assert.equal(handleSelectionAction({ viewTag: 3, itemId: 'search', text: 'z'.repeat(400) }, value), 'limit');
    assert.equal(calls.truncatedNotes, 0);
  });

  test('blank text and unknown items are ignored', () => {
    const { value, calls } = ports();
    assert.equal(handleSelectionAction({ viewTag: 3, itemId: 'search', text: '   ' }, value), 'ignored');
    assert.equal(handleSelectionAction({ viewTag: 3, itemId: 'notes', text: 'later' }, value), 'ignored');
    assert.equal(calls.opened.length, 0);
  });
});
