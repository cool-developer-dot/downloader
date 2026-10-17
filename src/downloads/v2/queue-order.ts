/**
 * H4: Priority (#305), Move Priority (#334) and Multiple Queues (#343). Pure.
 *
 * The native engine owns the order (engine/QueueOrder.kt): downloads start by queue, in the listed order, then by the
 * user's order inside the queue, then first-come; a held queue's downloads wait until it is resumed. Nothing set is
 * today's order. This file only computes what to send: a new order, or a new queue list.
 */

import type { DownloadQueue, DownloadQueueState } from '@modules/vidorax-media/src/VidoraMedia.types';

export const MAIN_QUEUE_ID = 'main';
export const MAX_QUEUES = 10;
export const MAX_QUEUE_NAME_LENGTH = 40;

const QUEUE_ID = /^[A-Za-z0-9_-]{1,40}$/;

const MAIN_QUEUE: DownloadQueue = { id: MAIN_QUEUE_ID, name: 'Main', held: false };

export const DEFAULT_QUEUE_STATE: DownloadQueueState = {
  queues: [MAIN_QUEUE],
  assignments: {},
  order: [],
};

export type ReorderDirection = 'top' | 'up' | 'down' | 'bottom';
export type QueueMoveDirection = 'up' | 'down';

/** A queue with its downloads, in the order they would start. */
export type QueueGroup = { queue: DownloadQueue; ids: string[] };

/** A download that can be reordered, as the Downloads list knows it. */
export type ReorderableDownload = { id: string; createdAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** What native returned, made safe to render: Main always present and never held, no unknown queues. */
export function normalizeQueueState(raw: unknown): DownloadQueueState {
  if (!isRecord(raw)) {
    return DEFAULT_QUEUE_STATE;
  }
  const seen = new Set<string>();
  const queues: DownloadQueue[] = [];
  for (const item of Array.isArray(raw.queues) ? raw.queues : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || !QUEUE_ID.test(item.id) || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    const main = item.id === MAIN_QUEUE_ID;
    queues.push({
      id: item.id,
      name: main ? 'Main' : typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
      held: !main && item.held === true,
    });
  }
  if (!seen.has(MAIN_QUEUE_ID)) {
    queues.unshift(MAIN_QUEUE);
  }
  const assignments: Record<string, string> = {};
  if (isRecord(raw.assignments)) {
    for (const [id, queueId] of Object.entries(raw.assignments)) {
      if (typeof queueId === 'string' && seen.has(queueId) && queueId !== MAIN_QUEUE_ID) {
        assignments[id] = queueId;
      }
    }
  }
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [];
  return { queues, assignments, order: [...new Set(order)] };
}

export function queueOf(state: DownloadQueueState, id: string): string {
  const queueId = state.assignments[id];
  return queueId && state.queues.some((queue) => queue.id === queueId) ? queueId : MAIN_QUEUE_ID;
}

/**
 * The downloads grouped by queue, every queue listed (also an empty one), each in start order: the user's order
 * first, then first-come (oldest first) for downloads the user has not moved.
 */
export function groupByQueue(state: DownloadQueueState, downloads: readonly ReorderableDownload[]): QueueGroup[] {
  const position = new Map(state.order.map((id, index) => [id, index]));
  const created = new Map(downloads.map((download) => [download.id, Date.parse(download.createdAt) || 0]));
  const sorted = [...downloads].sort((a, b) => {
    const byPosition = (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    return byPosition !== 0 ? byPosition : (created.get(a.id) ?? 0) - (created.get(b.id) ?? 0);
  });
  return state.queues.map((queue) => ({
    queue,
    ids: sorted.filter((download) => queueOf(state, download.id) === queue.id).map((download) => download.id),
  }));
}

/** [ids] with [id] moved; unchanged when it is not there or cannot move further. */
export function movedWithin(ids: readonly string[], id: string, direction: ReorderDirection): string[] {
  const from = ids.indexOf(id);
  if (from < 0) {
    return [...ids];
  }
  const to =
    direction === 'top' ? 0 : direction === 'bottom' ? ids.length - 1 : direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length || to === from) {
    return [...ids];
  }
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Whether [id] can move that way inside its queue. */
export function canMove(ids: readonly string[], id: string, direction: ReorderDirection): boolean {
  const index = ids.indexOf(id);
  if (index < 0) {
    return false;
  }
  return direction === 'top' || direction === 'up' ? index > 0 : index < ids.length - 1;
}

/**
 * The order to send after moving [id] inside its queue: every shown download, queue by queue, so the native order
 * says exactly what the screen shows. Null when nothing would change.
 */
export function orderAfterMove(groups: readonly QueueGroup[], id: string, direction: ReorderDirection): string[] | null {
  let changed = false;
  const order = groups.flatMap((group) => {
    if (!group.ids.includes(id)) {
      return group.ids;
    }
    const moved = movedWithin(group.ids, id, direction);
    changed = moved.some((value, index) => value !== group.ids[index]);
    return moved;
  });
  return changed ? order : null;
}

export type QueueNameProblem = 'empty' | 'too-long' | 'duplicate';

/** Why a queue name cannot be used; null when it can. Names are compared without case; Main's is reserved. */
export function queueNameProblem(
  raw: string,
  queues: readonly DownloadQueue[],
  options: { exceptId?: string; mainName?: string } = {},
): QueueNameProblem | null {
  const name = raw.trim();
  if (!name) {
    return 'empty';
  }
  if (name.length > MAX_QUEUE_NAME_LENGTH) {
    return 'too-long';
  }
  const lower = name.toLocaleLowerCase();
  const taken = queues.some(
    (queue) =>
      queue.id !== options.exceptId &&
      (queue.name.toLocaleLowerCase() === lower ||
        (queue.id === MAIN_QUEUE_ID && options.mainName?.toLocaleLowerCase() === lower)),
  );
  return taken ? 'duplicate' : null;
}

/** A new queue id not used yet: `q-` and a short random part. */
export function newQueueId(queues: readonly DownloadQueue[], random: () => number = Math.random): string {
  const used = new Set(queues.map((queue) => queue.id));
  for (;;) {
    const id = `q-${Math.floor(random() * 0x7fffffff).toString(36)}`;
    if (!used.has(id)) {
      return id;
    }
  }
}

export function canAddQueue(queues: readonly DownloadQueue[]): boolean {
  return queues.length < MAX_QUEUES;
}

export function withNewQueue(queues: readonly DownloadQueue[], id: string, name: string): DownloadQueue[] {
  return [...queues, { id, name: name.trim(), held: false }];
}

export function withRenamedQueue(queues: readonly DownloadQueue[], id: string, name: string): DownloadQueue[] {
  return queues.map((queue) => (queue.id === id && id !== MAIN_QUEUE_ID ? { ...queue, name: name.trim() } : queue));
}

/** Main cannot be deleted; a deleted queue's downloads go back to Main (the engine does that). */
export function withoutQueue(queues: readonly DownloadQueue[], id: string): DownloadQueue[] {
  return id === MAIN_QUEUE_ID ? [...queues] : queues.filter((queue) => queue.id !== id);
}

/** Main is never held, so with only Main downloads always start as before. */
export function withHeld(queues: readonly DownloadQueue[], id: string, held: boolean): DownloadQueue[] {
  return queues.map((queue) => (queue.id === id && id !== MAIN_QUEUE_ID ? { ...queue, held } : queue));
}

export function canMoveQueue(queues: readonly DownloadQueue[], id: string, direction: QueueMoveDirection): boolean {
  const index = queues.findIndex((queue) => queue.id === id);
  return index >= 0 && (direction === 'up' ? index > 0 : index < queues.length - 1);
}

export function withQueueMoved(
  queues: readonly DownloadQueue[],
  id: string,
  direction: QueueMoveDirection,
): DownloadQueue[] {
  if (!canMoveQueue(queues, id, direction)) {
    return [...queues];
  }
  const ids = movedWithin(
    queues.map((queue) => queue.id),
    id,
    direction,
  );
  return ids.flatMap((queueId) => queues.filter((queue) => queue.id === queueId));
}
