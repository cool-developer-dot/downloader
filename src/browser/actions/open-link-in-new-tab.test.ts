import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CreateTabResult } from '@/browser/tabs/types';

import { openInNewTabAction } from './builtins/open-in-new-tab.action.ts';
import { canOpenInNewTab, openLinkInNewTab } from './open-link-in-new-tab.ts';
import type { BrowserActionContext } from './types.ts';

function created(url: string): CreateTabResult {
  return {
    status: 'CREATED',
    tab: { id: 'tab-2', url } as unknown as Extract<CreateTabResult, { status: 'CREATED' }>['tab'],
    evictedTabIds: [],
  };
}

describe('openLinkInNewTab', () => {
  it('creates a tab with the link and reports no limit', () => {
    const calls: { url: string }[] = [];
    let limitNotices = 0;

    const result = openLinkInNewTab('  https://example.com/news?id=7#top  ', {
      createTab: (options) => {
        calls.push(options);
        return created(options.url);
      },
      onLimitReached: () => {
        limitNotices += 1;
      },
    });

    assert.deepEqual(calls, [{ url: 'https://example.com/news?id=7#top' }]);
    assert.equal(result?.status, 'CREATED');
    assert.equal(limitNotices, 0);
  });

  it('shows the tab-limit message when the store refuses an 11th tab', () => {
    let limitNotices = 0;

    const result = openLinkInNewTab('https://example.com/', {
      createTab: () => ({ status: 'LIMIT_REACHED', max: 10 }),
      onLimitReached: () => {
        limitNotices += 1;
      },
    });

    assert.equal(result?.status, 'LIMIT_REACHED');
    assert.equal(limitNotices, 1);
  });

  it('does nothing for links that are not web pages', () => {
    for (const url of ['mailto:a@example.com', 'tel:+923001234567', 'javascript:alert(1)', 'intent://x#Intent;end', '', 'not a url']) {
      let createCalls = 0;
      const result = openLinkInNewTab(url, {
        createTab: () => {
          createCalls += 1;
          return created(url);
        },
        onLimitReached: () => undefined,
      });
      assert.equal(result, null, url);
      assert.equal(createCalls, 0, url);
    }
  });

  it('accepts http and https only', () => {
    assert.equal(canOpenInNewTab('https://a.example/'), true);
    assert.equal(canOpenInNewTab('http://a.example/'), true);
    assert.equal(canOpenInNewTab('HTTPS://A.EXAMPLE/'), true);
    assert.equal(canOpenInNewTab('ftp://a.example/'), false);
    assert.equal(canOpenInNewTab('vidorax://home'), false);
  });
});

describe('Open in New Tab link action', () => {
  const context = (url: string, openInNewTab?: (url: string) => void): BrowserActionContext => ({
    url,
    pageUrl: 'https://news.example/',
    openInNewTab,
  });

  it('is enabled and offered for http(s) links', () => {
    assert.equal(openInNewTabAction.enabled, true);
    assert.equal(openInNewTabAction.isAvailable?.(context('https://news.example/a')), true);
  });

  it('is not offered for mailto: / tel: links', () => {
    assert.equal(openInNewTabAction.isAvailable?.(context('mailto:a@example.com')), false);
    assert.equal(openInNewTabAction.isAvailable?.(context('tel:123')), false);
  });

  it('asks the sheet to open the trimmed link', async () => {
    const opened: string[] = [];
    await openInNewTabAction.execute(context(' https://news.example/a ', (url) => opened.push(url)));
    assert.deepEqual(opened, ['https://news.example/a']);
  });

  it('has a translated label key', () => {
    assert.equal(openInNewTabAction.labelKey, 'browser.linkActions.openInNewTab');
  });
});
