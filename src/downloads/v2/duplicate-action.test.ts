import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { EnqueueRequest, EnqueueResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  applyDuplicateBypass,
  armDuplicateBypass,
  DEFAULT_DUPLICATE_ACTION,
  disarmDuplicateBypass,
  duplicateKey,
  hasDuplicateBypass,
  normalizeDuplicateAction,
  resetDuplicateBypassesForTests,
  uniqueCopyTitle,
  type DuplicateAction,
} from './duplicate-action';
import { resetDuplicateChoiceForTests, resolveDuplicateChoice, useDuplicatePromptStore, type DuplicateChoiceDeps } from './duplicate-choice';
import { buildV2EnqueueRequest, type V2HandoffInput } from './enqueue-request';
import type { V2EnginePort } from './engine-port';
import { findExistingDownload, handOffVerifiedVariant, resetV2HandoffForTests } from './handoff';
import { downloadRecord, PAGE_URL, qualityOption, requestContext } from './test-fixtures';

const INPUT: V2HandoffInput = {
  option: qualityOption({ sourceUrl: 'https://cdn.example/clip.mp4' }),
  title: 'Clip',
  pageUrl: PAGE_URL,
  thumbnailUrl: null,
  requestContext: requestContext(),
};

function request(overrides: Partial<EnqueueRequest> = {}): EnqueueRequest {
  const decision = buildV2EnqueueRequest(INPUT);
  assert.ok(decision.ok);
  return { ...decision.request, ...overrides };
}

describe('H12 duplicate action: values', () => {
  test('Skip is the default; anything unknown is Skip', () => {
    assert.equal(DEFAULT_DUPLICATE_ACTION, 'skip');
    assert.equal(normalizeDuplicateAction('replace'), 'replace');
    assert.equal(normalizeDuplicateAction('delete'), 'skip');
    assert.equal(normalizeDuplicateAction(undefined), 'skip');
  });

  test('Keep both names the copy "(2)", "(3)", … after the copies that exist', () => {
    assert.equal(uniqueCopyTitle('Clip', []), 'Clip (2)');
    assert.equal(uniqueCopyTitle('Clip', ['Clip']), 'Clip (2)');
    assert.equal(uniqueCopyTitle('Clip', ['Clip', 'Clip (2)']), 'Clip (3)');
    assert.equal(uniqueCopyTitle('Clip', ['Clip (2)', 'Clip (5)', 'Other (9)']), 'Clip (6)');
    assert.equal(uniqueCopyTitle('Clip (2)', ['Clip', 'Clip (2)']), 'Clip (3)');
    assert.equal(uniqueCopyTitle('  Clip ', ['Clip (2)']), 'Clip (3)');
  });
});

describe('H12 duplicate action: the bypass', () => {
  afterEach(() => resetDuplicateBypassesForTests());

  test('only the armed video skips the checks, and only while armed', () => {
    const own = request();
    const other = request({ url: 'https://cdn.example/other.mp4' });
    assert.equal(hasDuplicateBypass(own), false);
    armDuplicateBypass(duplicateKey(own), { title: 'Clip (2)' });
    assert.equal(hasDuplicateBypass(own), true);
    assert.equal(hasDuplicateBypass(other), false);

    const marked = request();
    applyDuplicateBypass(marked);
    assert.equal(marked.allowDuplicate, true);
    assert.equal(marked.title, 'Clip (2)');
    const untouched = request({ url: 'https://cdn.example/other.mp4' });
    applyDuplicateBypass(untouched);
    assert.equal('allowDuplicate' in untouched, false);

    disarmDuplicateBypass(duplicateKey(own));
    assert.equal(hasDuplicateBypass(own), false);
  });

  test('the video is recognised by the offer’s own link, as the engine does', () => {
    assert.equal(duplicateKey({ url: 'https://cdn.example/fresh.mp4?sig=2', identityUrl: 'https://cdn.example/clip.mp4' }), 'https://cdn.example/clip.mp4');
    assert.equal(duplicateKey({ url: ' https://cdn.example/clip.mp4 ' }), 'https://cdn.example/clip.mp4');
  });
});

describe('H12 duplicate action: the choice', () => {
  let tracked: [string, string][] = [];
  let prompted = 0;

  function deps(action: DuplicateAction, titles: string[] = []): DuplicateChoiceDeps {
    return {
      action: () => action,
      existingTitles: async () => titles,
      trackReplacement: (newId, oldId) => void tracked.push([newId, oldId]),
      prompt: (prompt) => {
        prompted += 1;
        useDuplicatePromptStore.setState({ prompt });
      },
    };
  }

  beforeEach(() => {
    tracked = [];
    prompted = 0;
    resetDuplicateChoiceForTests();
    resetDuplicateBypassesForTests();
  });

  test('Skip keeps today’s answer and starts nothing', async () => {
    let reruns = 0;
    const result = await resolveDuplicateChoice({ downloadId: 'old' }, INPUT, async () => (reruns++, { ok: true }), deps('skip'));
    assert.equal(result, null);
    assert.equal(reruns, 0);
  });

  test('Keep both downloads again with the checks off and a "(2)" title', async () => {
    let seen: EnqueueRequest | null = null;
    const result = await resolveDuplicateChoice(
      { downloadId: 'old' },
      INPUT,
      async () => {
        const marked = request();
        applyDuplicateBypass(marked);
        seen = marked;
        return { ok: true, downloadId: 'new', deduped: false };
      },
      deps('keep_both', ['Clip']),
    );
    assert.deepEqual(result, { ok: true, downloadId: 'new', deduped: false });
    assert.equal((seen as EnqueueRequest | null)?.allowDuplicate, true);
    assert.equal((seen as EnqueueRequest | null)?.title, 'Clip (2)');
    assert.deepEqual(tracked, [], 'Keep both never deletes anything');
    assert.equal(hasDuplicateBypass(request()), false, 'disarmed afterwards');
  });

  test('Replace remembers which old item the new copy replaces; a failed start remembers nothing', async () => {
    await resolveDuplicateChoice({ downloadId: 'old' }, INPUT, async () => ({ ok: true, downloadId: 'new', deduped: false }), deps('replace'));
    assert.deepEqual(tracked, [['new', 'old']]);
    tracked = [];
    await resolveDuplicateChoice({ downloadId: 'old' }, INPUT, async () => ({ ok: false }), deps('replace'));
    await resolveDuplicateChoice({ downloadId: 'old' }, INPUT, async () => ({ ok: true, downloadId: 'old', deduped: true }), deps('replace'));
    await resolveDuplicateChoice({ downloadId: null }, INPUT, async () => ({ ok: true, downloadId: 'n2', deduped: false }), deps('replace'));
    assert.deepEqual(tracked, []);
  });

  test('a rerun that throws still disarms the bypass', async () => {
    await assert.rejects(
      resolveDuplicateChoice({ downloadId: 'old' }, INPUT, async () => {
        throw new Error('boom');
      }, deps('keep_both')),
    );
    assert.equal(hasDuplicateBypass(request()), false);
  });

  test('Ask keeps today’s answer and offers the choice; the choice then runs once', async () => {
    let reruns = 0;
    const rerun = async () => {
      reruns += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { ok: true, downloadId: 'new', deduped: false };
    };
    const result = await resolveDuplicateChoice({ downloadId: 'old' }, INPUT, rerun, deps('ask'));
    assert.equal(result, null);
    assert.equal(prompted, 1);
    const prompt = useDuplicatePromptStore.getState().prompt;
    assert.ok(prompt);
    assert.equal(prompt.title, 'Clip');
    assert.equal(await prompt.choose('skip'), null);
    assert.equal(reruns, 0);
    const first = prompt.choose('replace');
    const second = prompt.choose('replace');
    assert.equal(await second, null, 'a second tap while it starts does nothing');
    assert.deepEqual(await first, { ok: true, downloadId: 'new', deduped: false });
    assert.equal(reruns, 1);
    assert.deepEqual(tracked, [['new', 'old']]);
  });
});

describe('H12 duplicate action: the handoff', () => {
  beforeEach(() => {
    resetV2HandoffForTests();
    resetDuplicateBypassesForTests();
  });

  function engine(sent: EnqueueRequest[]): V2EnginePort {
    return {
      findDuplicate: async () => ({ outcome: 'ALREADY_DOWNLOADED', libraryItemId: 'old', galleryUri: null }) as unknown as EnqueueResult,
      enqueueUnique: async (req: EnqueueRequest) => {
        sent.push(req);
        return req.allowDuplicate
          ? ({ outcome: 'ENQUEUED', record: downloadRecord({ id: 'new', title: req.title }), libraryItemId: null } as EnqueueResult)
          : ({ outcome: 'ALREADY_DOWNLOADED', libraryItemId: 'old', galleryUri: null } as unknown as EnqueueResult);
      },
    } as unknown as V2EnginePort;
  }

  test('without a choice the saved video is found, exactly as before', async () => {
    const sent: EnqueueRequest[] = [];
    const found = await findExistingDownload(INPUT, { engine: engine(sent), applyEntries: () => undefined });
    assert.equal(found?.duplicate, 'ALREADY_DOWNLOADED');
  });

  test('while Keep both runs, the lookup is skipped and the enqueue carries allowDuplicate', async () => {
    const sent: EnqueueRequest[] = [];
    armDuplicateBypass(duplicateKey(request()), { title: 'Clip (2)' });
    const found = await findExistingDownload(INPUT, { engine: engine(sent), applyEntries: () => undefined });
    assert.equal(found, null);
    const result = await handOffVerifiedVariant(
      { ...INPUT, variantKey: 'k' },
      { engine: engine(sent), applyEntries: () => undefined, statusOf: () => null, isOfferCurrent: () => true },
    );
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.allowDuplicate, true);
    assert.equal(sent[0]?.title, 'Clip (2)');
  });
});
