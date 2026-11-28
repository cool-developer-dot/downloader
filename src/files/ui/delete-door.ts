/**
 * Files F8 · the one door every delete goes through (Faran's decision, 2026-11-28: "every delete goes to the Recycle
 * bin"). Pure: `useDeleteWithUndo.ts` builds the app's door from Faran's `deleteItems` (F13), F2's Confirm before
 * delete and the Undo bar, and the tests build one from fakes.
 *
 * The door never touches a file itself. Faran's `deleteItems` puts each id in the bin while the bin is on (the file
 * stays where it is until the bin is emptied) and deletes it the normal way otherwise. That normal delete is VidoraX's
 * own copy only: cloud copies and copies saved to folders outside VidoraX are never deleted.
 */

export type DoorResult = { trashed: string[]; deleted: string[] };

export type DoorRequest<Source extends string> = {
  ids: readonly string[];
  source: Source;
  /** The file's name, for "Delete “clip.mp4” forever?" when one file goes. */
  name?: string;
  /** After the delete (also when nothing could be deleted). */
  onDone?: (result: DoorResult) => void;
};

export type DoorDeps<Source extends string> = {
  deleteItems: (ids: string[], opts: { source: Source }) => Promise<DoorResult>;
  /** F2's Confirm before delete. */
  confirmOn: () => boolean;
  /** Shows the confirm dialog for a request (it calls `run` on Confirm). */
  ask: (request: DoorRequest<Source>) => void;
  /** The "… moved to Recycle bin · Undo" bar for a finished delete. */
  showBar: (result: DoorResult, requested: number) => void;
};

export function createDeleteDoor<Source extends string>(deps: DoorDeps<Source>) {
  /** Deletes now (no dialog) and shows the bar. */
  async function run(request: DoorRequest<Source>): Promise<DoorResult> {
    const ids = [...new Set(request.ids)];
    let result: DoorResult = { trashed: [], deleted: [] };
    try {
      result = await deps.deleteItems(ids, { source: request.source });
    } catch {
      // Shown by the bar as "couldn't be deleted".
    }
    deps.showBar(result, ids.length);
    request.onDone?.(result);
    return result;
  }

  /** Asks first when Confirm before delete is on; otherwise deletes at once. */
  function request(request: DoorRequest<Source>): void {
    if (request.ids.length === 0) {
      return;
    }
    if (deps.confirmOn()) {
      deps.ask(request);
      return;
    }
    void run(request);
  }

  return { run, request };
}

/**
 * Delete on a Downloads row, its details page or its file actions page: a finished download is a file in VidoraX, so
 * it goes through the door (the bin). An unfinished one has no file yet, so it keeps the Downloads remove (cancel the
 * download, drop its partial data).
 */
export function downloadsDeleteRoute(status: string | null | undefined): 'door' | 'unfinished' {
  return status === 'COMPLETED' ? 'door' : 'unfinished';
}

/** Whether a door result says this id left the library (into the bin, or deleted with the bin off). */
export function wasDeleted(result: DoorResult, id: string): boolean {
  return result.trashed.includes(id) || result.deleted.includes(id);
}
