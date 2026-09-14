/**
 * Worker settle barrier — pause/resume must wait until run() fully settles.
 * Generation-scoped: an old run's promise must not satisfy a newer pause.
 */

export type WorkerSettleBarrier = {
  promise: Promise<void>;
  resolve: () => void;
};

export type PauseSettleHandle = {
  generation: number;
  barrier: WorkerSettleBarrier;
};

export function createWorkerSettleBarrier(): WorkerSettleBarrier {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function capturePauseSettleHandle(
  generation: number,
  barrier: WorkerSettleBarrier | null,
): PauseSettleHandle | null {
  if (!barrier) {
    return null;
  }
  return { generation, barrier };
}

export function isSamePauseGeneration(
  handle: PauseSettleHandle | null | undefined,
  generation: number | null | undefined,
): boolean {
  if (handle == null || generation == null) {
    return handle == null && generation == null;
  }
  return handle.generation === generation;
}

export async function waitForCapturedSettle(
  handle: PauseSettleHandle | null | undefined,
  fallback: WorkerSettleBarrier | null | undefined,
): Promise<void> {
  const barrier = handle?.barrier ?? fallback ?? null;
  if (barrier) {
    await barrier.promise;
  }
}

export type PauseSettleWaitResult = {
  settled: boolean;
  timedOut: boolean;
};

/**
 * Pause/resume must not wait unboundedly for a hung native downloadAsync().
 * Timeout means the pause signal was sent; caller still commits PAUSED from disk.
 */
export async function waitForCapturedSettleWithTimeout(
  handle: PauseSettleHandle | null | undefined,
  fallback: WorkerSettleBarrier | null | undefined,
  timeoutMs: number,
): Promise<PauseSettleWaitResult> {
  const barrier = handle?.barrier ?? fallback ?? null;
  if (!barrier) {
    return { settled: true, timedOut: false };
  }
  const bound = Math.max(1, Math.trunc(timeoutMs));
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, bound);
  });
  try {
    await Promise.race([barrier.promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  return { settled: !timedOut, timedOut };
}

/** Old generation cannot satisfy a pause aimed at a newer worker run. */
export function oldGenerationCannotSatisfyPause(
  pausedGeneration: number,
  currentGeneration: number | null | undefined,
  currentRunning: boolean,
): boolean {
  if (currentGeneration == null) {
    return false;
  }
  return currentRunning && currentGeneration !== pausedGeneration;
}
