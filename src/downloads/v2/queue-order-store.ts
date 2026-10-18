import type { DownloadQueue, DownloadQueueState } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createStore } from '@/store/shared/create-store';

import { getV2Engine, type V2EnginePort } from './engine-port';
import {
  DEFAULT_QUEUE_STATE,
  normalizeQueueState,
  orderAfterMove,
  type QueueGroup,
  type ReorderDirection,
} from './queue-order';

/**
 * H4: the Downloads tab's Reorder mode and the engine's queues, mirrored. Never persisted here: the native engine is
 * the only place the order lives (it survives restarts there). One change at a time — a second tap while one is
 * being saved is ignored — and every change shows what the engine answered, never a guess.
 */
type QueueOrderStoreState = {
  /** The Reorder mode in the Downloads tab. */
  reorderMode: boolean;
  queueState: DownloadQueueState;
  loaded: boolean;
  /** A change is being saved. */
  busy: boolean;
  /** The last change failed; cleared by the next one. */
  failed: boolean;
};

export const useQueueOrderStore = createStore<QueueOrderStoreState>()(() => ({
  reorderMode: false,
  queueState: DEFAULT_QUEUE_STATE,
  loaded: false,
  busy: false,
  failed: false,
}));

type QueuePort = Required<
  Pick<V2EnginePort, 'getDownloadQueues' | 'setDownloadOrder' | 'moveDownloadsToQueue' | 'setDownloadQueues'>
>;

/** The engine's queue functions, or null on a build without them (then there is no Reorder mode). */
export function queuePort(engine: V2EnginePort | null = getV2Engine()): QueuePort | null {
  if (
    !engine?.getDownloadQueues ||
    !engine.setDownloadOrder ||
    !engine.moveDownloadsToQueue ||
    !engine.setDownloadQueues
  ) {
    return null;
  }
  return engine as QueuePort;
}

export function isQueueOrderSupported(): boolean {
  return queuePort() !== null;
}

/** Runs one change; false when another is still being saved, the build has no queues, or the change failed. */
async function run(change: (port: QueuePort) => Promise<DownloadQueueState>): Promise<boolean> {
  const port = queuePort();
  if (!port || useQueueOrderStore.getState().busy) {
    return false;
  }
  useQueueOrderStore.setState({ busy: true, failed: false });
  try {
    const next = normalizeQueueState(await change(port));
    useQueueOrderStore.setState({ queueState: next, loaded: true, busy: false });
    return true;
  } catch {
    useQueueOrderStore.setState({ busy: false, failed: true });
    return false;
  }
}

/** Reads the engine's queues again (entering Reorder mode, after downloads changed). */
export async function refreshQueueState(): Promise<void> {
  const port = queuePort();
  if (!port) {
    return;
  }
  try {
    const next = normalizeQueueState(await port.getDownloadQueues());
    useQueueOrderStore.setState({ queueState: next, loaded: true });
  } catch {
    // Keeps what is shown; the next change reports a failure if the engine really is unavailable.
  }
}

export function setReorderMode(on: boolean): void {
  if (useQueueOrderStore.getState().reorderMode !== on) {
    useQueueOrderStore.setState({ reorderMode: on, failed: false });
  }
  if (on) {
    void refreshQueueState();
  }
}

/** Moves a download inside its queue: up, down, to the top or to the bottom. */
export function moveDownload(groups: readonly QueueGroup[], id: string, direction: ReorderDirection): Promise<boolean> {
  const order = orderAfterMove(groups, id, direction);
  if (!order) {
    return Promise.resolve(false);
  }
  return run((port) => port.setDownloadOrder(order));
}

export function moveDownloadsToQueue(ids: string[], queueId: string): Promise<boolean> {
  return run((port) => port.moveDownloadsToQueue(ids, queueId));
}

/** Saves the queue list: new, renamed, held or resumed, deleted, or moved queues. */
export function saveQueues(queues: DownloadQueue[]): Promise<boolean> {
  return run((port) => port.setDownloadQueues(queues));
}

export function resetQueueOrderStoreForTests(): void {
  useQueueOrderStore.setState({
    reorderMode: false,
    queueState: DEFAULT_QUEUE_STATE,
    loaded: false,
    busy: false,
    failed: false,
  });
}
