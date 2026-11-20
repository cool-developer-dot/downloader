/**
 * P6: links from the Web UI, the browser extension, the CLI and other apps (#499), checked one at a time through the
 * app's own Batch Add path (`addLinkFromBatch`: the same page check, refusals — YouTube, DRM, private hosts — and
 * duplicate protection as a pasted link). Each result goes back to the phone's server, which tells the sender.
 * Pure (the ports are passed in), so it runs under Node.
 */

import type { RemoteLinkOutcome, RemoteLinkRequest } from '@modules/vidorax-media/src/VidoraRemote.types';

export type IntakeResult = {
  outcome: RemoteLinkOutcome;
  title: string | null;
  downloadId: string | null;
  detail: string;
};

export type LinkIntakePorts = {
  addLink: (url: string, signal: AbortSignal) => Promise<IntakeResult>;
  report: (
    requestId: string,
    outcome: RemoteLinkOutcome,
    title: string | null,
    downloadId: string | null,
    detail: string | null,
  ) => Promise<unknown>;
  /** A link check that takes longer is given up as "needs review". */
  timeoutMs?: number;
};

export const LINK_CHECK_TIMEOUT_MS = 60_000;
const REMEMBERED_REQUESTS = 200;

export type LinkIntakeQueue = {
  enqueue: (request: RemoteLinkRequest) => void;
  /** Resolves once every queued link has been checked and reported. */
  whenIdle: () => Promise<void>;
};

export function createLinkIntakeQueue(ports: LinkIntakePorts): LinkIntakeQueue {
  const queue: RemoteLinkRequest[] = [];
  const seen = new Set<string>();
  let draining: Promise<void> | null = null;

  async function checkOne(request: RemoteLinkRequest): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ports.timeoutMs ?? LINK_CHECK_TIMEOUT_MS);
    let result: IntakeResult;
    try {
      result = await ports.addLink(request.url, controller.signal);
    } catch {
      result = { outcome: 'needs-review', title: null, downloadId: null, detail: 'ERROR' };
    } finally {
      clearTimeout(timer);
    }
    try {
      await ports.report(request.requestId, result.outcome, result.title, result.downloadId, result.detail);
    } catch {
      // The phone's server is gone (stopped or reloading); the link itself was handled.
    }
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      await checkOne(queue.shift()!);
    }
    draining = null;
  }

  return {
    enqueue(request) {
      if (!request?.requestId || seen.has(request.requestId)) {
        return;
      }
      seen.add(request.requestId);
      if (seen.size > REMEMBERED_REQUESTS) {
        seen.delete(seen.values().next().value!);
      }
      queue.push(request);
      draining ??= drain();
    },
    whenIdle: () => draining ?? Promise.resolve(),
  };
}
