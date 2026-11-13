import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { DownloadCredentials, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  askForSignIn,
  basicChallengeOf,
  credentialsProblem,
  ensureDownloadSignIn,
  isSecureOrigin,
  setDownloadSignInPrompt,
  signInHost,
} from './download-auth';
import type { V2EnginePort } from './engine-port';
import { offerSignInDownload, titleFromLink } from './sign-in-download';
import { downloadRecord } from './test-fixtures';

afterEach(() => setDownloadSignInPrompt(null));

const ALICE: DownloadCredentials = { username: 'alice', password: 'pw' };
const ORIGIN = 'https://nas.example.com:443';

function unauthorized(origin = ORIGIN, realm: string | null = 'Home NAS'): ProbeResult {
  return {
    ok: false,
    reason: 'HTTP_403',
    httpStatus: 401,
    message: 'Access denied',
    authChallenge: { scheme: 'basic', origin, realm },
  };
}

describe('download sign-in rules (#299)', () => {
  test('only a Basic challenge of a failed probe counts', () => {
    assert.deepEqual(basicChallengeOf(unauthorized()), { scheme: 'basic', origin: ORIGIN, realm: 'Home NAS' });
    assert.equal(basicChallengeOf({ ok: false, reason: 'HTTP_403', httpStatus: 401, message: null }), null);
    assert.equal(basicChallengeOf(null), null);
    assert.equal(
      basicChallengeOf({
        ok: true,
        kind: 'progressive',
        finalUrl: 'https://x',
        contentType: null,
        container: 'mp4',
        sizeBytes: null,
        resumable: true,
        variants: [],
        audioTracks: [],
        durationMs: null,
      }),
      null,
    );
  });

  test('credentials are only ever for https', () => {
    assert.equal(isSecureOrigin('https://nas.example.com:443'), true);
    assert.equal(isSecureOrigin('http://nas.example.com:80'), false);
    assert.equal(isSecureOrigin('nonsense'), false);
    assert.equal(isSecureOrigin(null), false);
    assert.equal(signInHost('https://nas.example.com:443'), 'nas.example.com');
  });

  test('what may be sent (RFC 7617, the same rules as native code)', () => {
    assert.equal(credentialsProblem('alice', 'p:a ss'), null);
    assert.equal(credentialsProblem('', 'pw'), 'USERNAME_REQUIRED');
    assert.equal(credentialsProblem('al:ice', 'pw'), 'USERNAME_COLON');
    assert.equal(credentialsProblem('x'.repeat(257), 'pw'), 'TOO_LONG');
    assert.equal(credentialsProblem('alice', 'y'.repeat(257)), 'TOO_LONG');
    assert.equal(credentialsProblem('ali\nce', 'pw'), 'CONTROL_CHARACTERS');
    assert.equal(credentialsProblem('alice', 'p\u0000w'), 'CONTROL_CHARACTERS');
  });

  test('the dialog is never shown for an insecure origin, and a bad answer is no answer', async () => {
    let asked = 0;
    setDownloadSignInPrompt(async () => {
      asked += 1;
      return { username: 'al:ice', password: 'pw' };
    });
    assert.equal(await askForSignIn({ origin: 'http://nas.example.com:80', realm: null }), null);
    assert.equal(asked, 0);
    assert.equal(await askForSignIn({ origin: ORIGIN, realm: null }), null);
    assert.equal(asked, 1);
    setDownloadSignInPrompt(null);
    assert.equal(await askForSignIn({ origin: ORIGIN, realm: null }), null, 'no dialog registered');
  });
});

describe('resume / retry of a download started with sign-in', () => {
  function engine(needed: { origin: string; realm: string | null } | null) {
    const set: { id: string; credentials: DownloadCredentials }[] = [];
    const port = {
      downloadNeedsCredentials: () => needed,
      setDownloadCredentials: async (id: string, credentials: DownloadCredentials) => {
        set.push({ id, credentials });
        return true;
      },
    } as unknown as V2EnginePort;
    return { port, set };
  }

  test('nothing needed, or an older native build: the action goes ahead without a dialog', async () => {
    let asked = 0;
    setDownloadSignInPrompt(async () => {
      asked += 1;
      return ALICE;
    });
    assert.equal(await ensureDownloadSignIn(engine(null).port, 'dl'), 'ready');
    assert.equal(await ensureDownloadSignIn({} as V2EnginePort, 'dl'), 'ready');
    assert.equal(await ensureDownloadSignIn(null, 'dl'), 'ready');
    assert.equal(asked, 0);
  });

  test('after a process death it asks again and hands them over once', async () => {
    setDownloadSignInPrompt(async (request) => {
      assert.deepEqual(request, { origin: ORIGIN, realm: 'Home NAS' });
      return ALICE;
    });
    const { port, set } = engine({ origin: ORIGIN, realm: 'Home NAS' });
    assert.equal(await ensureDownloadSignIn(port, 'dl'), 'ready');
    assert.deepEqual(set, [{ id: 'dl', credentials: ALICE }]);
  });

  test('a cancel stops the action', async () => {
    setDownloadSignInPrompt(async () => null);
    const { port, set } = engine({ origin: ORIGIN, realm: null });
    assert.equal(await ensureDownloadSignIn(port, 'dl'), 'cancelled');
    assert.equal(set.length, 0);
  });
});

describe('a pasted link to a password-protected file (#299)', () => {
  type Harness = { enqueued: unknown[]; applied: unknown[]; notified: string[]; asked: number };

  function deps(probe: ProbeResult, answer: DownloadCredentials | null, enqueue?: () => Promise<unknown>) {
    const h: Harness = { enqueued: [], applied: [], notified: [], asked: 0 };
    const engine = {
      probe: async () => probe,
      enqueue: async (request: unknown) => {
        h.enqueued.push(request);
        if (enqueue) {
          return enqueue();
        }
        return downloadRecord({ id: 'dl-1' });
      },
    } as unknown as V2EnginePort;
    return {
      h,
      deps: {
        engine,
        ask: async () => {
          h.asked += 1;
          return answer;
        },
        applyEntries: (entries: unknown[]) => h.applied.push(...entries),
        notify: (outcome: string) => h.notified.push(outcome),
        userAgent: 'UA',
      },
    };
  }

  const URL_ = 'https://nas.example.com/videos/Holiday%20clip.mp4';

  test('asked once, then downloaded with the credentials for this download only', async () => {
    const { h, deps: d } = deps(unauthorized(), ALICE);
    assert.equal(await offerSignInDownload(URL_, d), 'started');
    assert.equal(h.asked, 1);
    assert.equal(h.enqueued.length, 1);
    const request = h.enqueued[0] as Record<string, unknown>;
    assert.equal(request.url, URL_);
    assert.equal(request.kind, 'progressive');
    assert.deepEqual(request.credentials, ALICE);
    assert.equal(request.title, 'Holiday clip');
    assert.deepEqual(request.request, { userAgent: 'UA', headers: {}, useCookies: false });
    assert.equal(h.applied.length, 1);
    assert.deepEqual(h.notified, ['started']);
  });

  test('no challenge (another refusal, an older build): nothing is asked', async () => {
    const { h, deps: d } = deps({ ok: false, reason: 'HTTP_404', httpStatus: 404, message: null }, ALICE);
    assert.equal(await offerSignInDownload(URL_, d), 'not_needed');
    assert.equal(h.asked, 0);
    assert.equal(h.enqueued.length, 0);
  });

  test('an http link or challenge is refused with a message and nothing is asked', async () => {
    const insecure = deps(unauthorized('http://nas.example.com:80'), ALICE);
    assert.equal(await offerSignInDownload('http://nas.example.com/v.mp4', insecure.deps), 'insecure');
    assert.equal(insecure.h.asked, 0);
    assert.deepEqual(insecure.h.notified, ['insecure']);
  });

  test('a challenge from another origin could never be answered: nothing is asked', async () => {
    const other = deps(unauthorized('https://login.example.org:443'), ALICE);
    assert.equal(await offerSignInDownload(URL_, other.deps), 'not_needed');
    assert.equal(other.h.asked, 0);
  });

  test('a cancel starts nothing', async () => {
    const { h, deps: d } = deps(unauthorized(), null);
    assert.equal(await offerSignInDownload(URL_, d), 'cancelled');
    assert.equal(h.enqueued.length, 0);
    assert.deepEqual(h.notified, []);
  });

  test('the same video already downloading or saved says which', async () => {
    const downloading = deps(unauthorized(), ALICE, async () => {
      throw new Error('not used');
    });
    const engine = downloading.deps.engine as unknown as Record<string, unknown>;
    engine.enqueueUnique = async () => ({ outcome: 'ALREADY_DOWNLOADING', record: downloadRecord({ id: 'dl-0' }) });
    assert.equal(await offerSignInDownload(URL_, downloading.deps), 'already_downloading');
    assert.deepEqual(downloading.h.notified, ['already_downloading']);
    assert.equal(downloading.h.applied.length, 1, 'the existing download is shown in Downloads');

    const saved = deps(unauthorized(), ALICE);
    (saved.deps.engine as unknown as Record<string, unknown>).enqueueUnique = async () => ({
      outcome: 'ALREADY_DOWNLOADED',
      libraryItemId: 'v1',
      galleryUri: null,
    });
    assert.equal(await offerSignInDownload(URL_, saved.deps), 'already_downloaded');
    assert.deepEqual(saved.h.notified, ['already_downloaded']);
  });

  test('a refused enqueue says so', async () => {
    const { deps: d, h } = deps(unauthorized(), ALICE, async () => {
      throw Object.assign(new Error('nope'), { code: 'ERR_INVALID_REQUEST' });
    });
    assert.equal(await offerSignInDownload(URL_, d), 'failed');
    assert.deepEqual(h.notified, ['failed']);
  });

  test('titles come from the file name', () => {
    assert.equal(titleFromLink('https://nas.example.com/a/My%20Film.mkv'), 'My Film');
    assert.equal(titleFromLink('https://nas.example.com/'), 'nas.example.com');
    assert.equal(titleFromLink('not a url'), 'Video');
  });
});
