import { createStore } from '@/store/shared/create-store';

import { createEditJob, type EditJob, type EditJobState } from './edit-job';
import { getEditPort } from './edit-port';

/** The edit job's state for the UI (memory only; one edit at a time across the app). */
export const useEditJobStore = createStore<{ job: EditJobState }>()(() => ({ job: { phase: 'idle' } }));

const JOB_KEY = '__vidoraxEditJob';

/**
 * The app's one edit job, kept on `globalThis` so a Fast Refresh never makes a second controller that would let two
 * edits run or lose track of the running one. Null on builds without the native editor.
 */
export function getEditJob(): EditJob | null {
  const port = getEditPort();
  if (!port) {
    return null;
  }
  const slot = globalThis as unknown as Record<string, EditJob | undefined>;
  const existing = slot[JOB_KEY];
  if (existing) {
    return existing;
  }
  const job = createEditJob({
    startEdit: (request) => port.startEdit(request),
    getProgress: () => port.getEditProgress(),
    cancelEdit: () => port.cancelEdit(),
    onChange: (state) => useEditJobStore.setState({ job: state }),
    schedule: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  slot[JOB_KEY] = job;
  return job;
}
