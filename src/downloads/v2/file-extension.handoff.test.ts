import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import { setFileExtensionSource } from './filename-naming';
import { handOffVerifiedVariant, resetV2HandoffForTests } from './handoff';
import { downloadRecord, PAGE_URL, qualityOption, requestContext } from './test-fixtures';

function capture(): { enqueued: EnqueueRequest[]; deps: Parameters<typeof handOffVerifiedVariant>[1] } {
  const enqueued: EnqueueRequest[] = [];
  const engine = {
    probe: async () => {
      throw new Error('a verified progressive variant is not probed again');
    },
    enqueue: async (request: EnqueueRequest) => {
      enqueued.push(request);
      return downloadRecord({ id: `dl-${enqueued.length}` });
    },
  } as unknown as V2EnginePort;
  return {
    enqueued,
    deps: { engine, applyEntries: () => undefined, statusOf: () => null, isOfferCurrent: () => true },
  };
}

const variant = { title: 'Clip', pageUrl: PAGE_URL, thumbnailUrl: null, requestContext: requestContext() };

beforeEach(() => resetV2HandoffForTests());
afterEach(() => setFileExtensionSource(null));

describe('custom extension (#494) in the handoff', () => {
  test('Automatic leaves the request exactly as before', async () => {
    setFileExtensionSource(() => 'auto');
    const h = capture();
    await handOffVerifiedVariant({ ...variant, option: qualityOption(), variantKey: 'k-auto' }, h.deps);
    assert.equal(h.enqueued.length, 1);
    assert.equal('preferredExtension' in h.enqueued[0]!, false);
  });

  test('a chosen extension rides along with the new download', async () => {
    setFileExtensionSource(() => 'm4v');
    const h = capture();
    await handOffVerifiedVariant({ ...variant, option: qualityOption(), variantKey: 'k-m4v' }, h.deps);
    assert.equal(h.enqueued[0]?.preferredExtension, 'm4v');
  });
});
