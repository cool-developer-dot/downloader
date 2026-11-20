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
  /** Tests only: the wait after the abort before a check that ignores it is left behind. */
  abortGraceMs?: number;
};

/**
 * How long one link may take. The app's own Batch Add has no overall limit; a big file on a slow phone took ~65 s on
 * the test device, so the cap is generous. It exists only so one stuck check never holds up the links behind it.
 */
export const LINK_CHECK_TIMEOUT_MS = 180_000;
/** After the abort, how long a check may take to wind down before the queue moves on without it. */
const ABORT_GRACE_MS = 5_000;
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
    const limit = ports.timeoutMs ?? LINK_CHECK_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), limit);
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    // A check that ignores the abort (a native call with no cancel) must not stall the queue.
    const stuck = new Promise<IntakeResult>((resolve) => {
      giveUp = setTimeout(
        () => resolve({ outcome: 'needs-review', title: null, downloadId: null, detail: 'TIMEOUT' }),
        limit + (ports.abortGraceMs ?? ABORT_GRACE_MS),
      );
    });
    let result: IntakeResult;
    try {
      result = await Promise.race([ports.addLink(request.url, controller.signal), stuck]);
    } catch {
      result = { outcome: 'needs-review', title: null, downloadId: null, detail: 'ERROR' };
    } finally {
      clearTimeout(timer);
      clearTimeout(giveUp);
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
