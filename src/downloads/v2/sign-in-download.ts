/**
 * Authentication Support (#299) for a link pasted or shared into a tab: a password-protected file server answers it
 * with `401` and `WWW-Authenticate: Basic`. The native probe confirms the challenge; over https, and only when the
 * challenge comes from the link's own origin (the only place native code will ever send them), the user is asked for
 * a user name and password and the file is downloaded with them. The engine still classifies what it gets, so a file
 * that is not a video fails as such. The credentials are a local of this call: handed to the enqueue, then dropped.
 */

import type {
  AuthChallenge,
  DownloadCredentials,
  EnqueueRequest,
  EnqueueResult,
  RequestContext,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import { basicChallengeOf, isSecureOrigin, type SignInRequest } from './download-auth';
import type { V2EnginePort } from './engine-port';
import { siteIdForPage } from './enqueue-request';
import { projectV2Download, type V2DownloadEntry } from './projection';

export type SignInDownloadOutcome = 'started' | 'duplicate' | 'cancelled' | 'not_needed' | 'insecure' | 'failed';

export type SignInDownloadDeps = {
  engine: V2EnginePort | null;
  ask: (request: SignInRequest) => Promise<DownloadCredentials | null>;
  applyEntries: (entries: V2DownloadEntry[]) => void;
  /** A short toast for the outcome ('started', 'insecure', 'failed'). */
  notify: (outcome: SignInDownloadOutcome) => void;
  userAgent?: string | null;
};

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

/** Pure: the title a signed-in download starts with — the file's name without its extension, else the host. */
export function titleFromLink(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    let name = last;
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
    const dot = name.lastIndexOf('.');
    const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
    return stem || parsed.hostname || 'Video';
  } catch {
    return 'Video';
  }
}

export async function offerSignInDownload(url: string, deps: SignInDownloadDeps): Promise<SignInDownloadOutcome> {
  const engine = deps.engine;
  if (!engine) {
    return 'not_needed';
  }
  const context: RequestContext = {
    ...(deps.userAgent ? { userAgent: deps.userAgent } : {}),
    headers: {},
    useCookies: false,
  };
  let challenge: AuthChallenge | null;
  try {
    challenge = basicChallengeOf(await engine.probe({ url, request: context }));
  } catch {
    return 'not_needed';
  }
  if (!challenge) {
    return 'not_needed';
  }
  if (!isSecureOrigin(url) || !isSecureOrigin(challenge.origin)) {
    deps.notify('insecure');
    return 'insecure';
  }
  // Native code pins sign-in to the link's own origin: a challenge from anywhere else could never be answered.
  if (originOf(challenge.origin) !== originOf(url)) {
    return 'not_needed';
  }
  const credentials = await deps.ask({ origin: challenge.origin, realm: challenge.realm });
  if (!credentials) {
    return 'cancelled';
  }
  const request: EnqueueRequest = {
    url,
    kind: 'progressive',
    request: context,
    title: titleFromLink(url),
    site: siteIdForPage(url),
    pageUrl: url,
    credentials,
  };
  try {
    const result: EnqueueResult = engine.enqueueUnique
      ? await engine.enqueueUnique(request)
      : { outcome: 'ENQUEUED', record: await engine.enqueue(request), libraryItemId: null };
    if (result.outcome === 'ENQUEUED' || result.outcome === 'ALREADY_DOWNLOADING') {
      deps.applyEntries([projectV2Download(result.record)]);
    }
    const outcome: SignInDownloadOutcome = result.outcome === 'ENQUEUED' ? 'started' : 'duplicate';
    deps.notify(outcome);
    return outcome;
  } catch {
    deps.notify('failed');
    return 'failed';
  }
}
