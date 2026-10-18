/**
 * The one edit that may run at a time (#374, #376): start, progress, Cancel. Cancelling — or any failure — leaves no
 * partial output: the native editor deletes it; this only reports. Everything is injected, so the rules are tested.
 */

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { EditKind } from './edit-plan';

export type EditFailure = 'busy' | 'no-space' | 'refused' | 'missing' | 'failed';

export type EditJobState =
  | { phase: 'idle' }
  | { phase: 'running'; sourceId: string; kind: EditKind; progress: number | null }
  | { phase: 'cancelling'; sourceId: string; kind: EditKind }
  | { phase: 'done'; sourceId: string; kind: EditKind; itemId: string }
  | { phase: 'cancelled'; sourceId: string; kind: EditKind }
  | { phase: 'failed'; sourceId: string; kind: EditKind; reason: EditFailure };

export type EditJobDeps = {
  startEdit: (request: EditRequest) => Promise<LibraryItem>;
  getProgress: () => number | null;
  cancelEdit: () => Promise<void>;
  onChange: (state: EditJobState) => void;
  schedule: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export const EDIT_PROGRESS_POLL_MS = 500;

/** The failure a native rejection means. */
export function editFailure(error: unknown): EditFailure {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'ERR_INVALID_STATE':
      return 'busy';
    case 'ERR_NO_SPACE':
      return 'no-space';
    case 'ERR_EDIT_REFUSED':
      return 'refused';
    case 'ERR_NOT_FOUND':
      return 'missing';
    default:
      return 'failed';
  }
}

/** The native editor stopped the edit — Cancel in the app or in the edit's notification (H23). */
export function isEditCancelled(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'ERR_EDIT_CANCELLED';
}

export function isEditRunning(state: EditJobState): state is Extract<EditJobState, { phase: 'running' | 'cancelling' }> {
  return state.phase === 'running' || state.phase === 'cancelling';
}

export function createEditJob(deps: EditJobDeps) {
  let state: EditJobState = { phase: 'idle' };
  let poll: unknown = null;

  /** Read through a function: `cancel` may change the state while `start` awaits. */
  function current(): EditJobState {
    return state;
  }

  function set(next: EditJobState): void {
    state = next;
    deps.onChange(next);
  }

  function stopPolling(): void {
    if (poll !== null) {
      deps.clear(poll);
      poll = null;
    }
  }

  function pollProgress(): void {
    poll = deps.schedule(() => {
      poll = null;
      if (state.phase !== 'running') {
        return;
      }
      let progress: number | null = null;
      try {
        progress = deps.getProgress();
      } catch {
        progress = null;
      }
      if (state.phase === 'running') {
        set({ ...state, progress: typeof progress === 'number' ? Math.min(1, Math.max(0, progress)) : state.progress });
        pollProgress();
      }
    }, EDIT_PROGRESS_POLL_MS);
  }

  return {
    state: (): EditJobState => state,

    /** Runs one edit. A second one while the first runs is refused at once ('busy'). */
    async start(request: EditRequest): Promise<EditJobState> {
      const kind = request.kind;
      if (isEditRunning(state)) {
        return { phase: 'failed', sourceId: request.sourceId, kind, reason: 'busy' };
      }
      set({ phase: 'running', sourceId: request.sourceId, kind, progress: null });
      pollProgress();
      try {
        const item = await deps.startEdit(request);
        stopPolling();
        // Cancelled just as it finished: the result stands (it is a complete, verified new item).
        set({ phase: 'done', sourceId: request.sourceId, kind, itemId: item.id });
      } catch (error) {
        stopPolling();
        // Cancel in the edit's notification reaches only the native side: its rejection says so.
        const cancelled = current().phase === 'cancelling' || isEditCancelled(error);
        set(
          cancelled
            ? { phase: 'cancelled', sourceId: request.sourceId, kind }
            : { phase: 'failed', sourceId: request.sourceId, kind, reason: editFailure(error) },
        );
      }
      return current();
    },

    /** Stops the running edit; does nothing when none runs or it is already stopping. */
    cancel(): void {
      if (state.phase !== 'running') {
        return;
      }
      set({ phase: 'cancelling', sourceId: state.sourceId, kind: state.kind });
      stopPolling();
      void deps.cancelEdit().catch(() => undefined);
    },

    /** Back to idle after a finished job was shown (never while one runs). */
    reset(): void {
      if (!isEditRunning(state)) {
        stopPolling();
        set({ phase: 'idle' });
      }
    },
  };
}

export type EditJob = ReturnType<typeof createEditJob>;
