/**
 * Phase 7C — per-download operation coordination (pure + in-memory).
 * EXPORT and DELETE must not race the same canonical file.
 */

export type CompletedFileOpKind = 'idle' | 'exporting' | 'deleting';

type OpEntry = {
  kind: Exclude<CompletedFileOpKind, 'idle'>;
  promise: Promise<unknown>;
};

const ops = new Map<string, OpEntry>();

export function getCompletedFileOpKind(downloadId: string): CompletedFileOpKind {
  return ops.get(downloadId)?.kind ?? 'idle';
}

export function isCompletedFileOpBusy(downloadId: string): boolean {
  return ops.has(downloadId);
}

/**
 * Run an exclusive op for downloadId. Duplicate same-kind joins the in-flight promise.
 * Conflicting kind throws.
 */
export async function withCompletedFileOperation<T>(
  downloadId: string,
  kind: Exclude<CompletedFileOpKind, 'idle'>,
  run: () => Promise<T>,
): Promise<T> {
  const id = downloadId.trim();
  if (!id) {
    throw new Error('downloadId required');
  }

  const existing = ops.get(id);
  if (existing) {
    if (existing.kind === kind) {
      return existing.promise as Promise<T>;
    }
    throw new Error(
      kind === 'exporting' ? 'DELETE_IN_PROGRESS' : 'EXPORT_IN_PROGRESS',
    );
  }

  const entry: OpEntry = {
    kind,
    promise: Promise.resolve() as Promise<unknown>,
  };
  const promise = (async () => {
    try {
      return await run();
    } finally {
      if (ops.get(id) === entry) {
        ops.delete(id);
      }
    }
  })();
  entry.promise = promise;
  ops.set(id, entry);
  return promise;
}

/** Test helper — clear all in-memory ops. */
export function resetCompletedFileOperationsForTests(): void {
  ops.clear();
}
