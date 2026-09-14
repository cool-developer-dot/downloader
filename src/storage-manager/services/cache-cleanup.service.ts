import { Directory, Paths } from 'expo-file-system';

function deleteEntryQuiet(entry: Directory | import('expo-file-system').File): number {
  let size = 0;
  try {
    if (entry instanceof Directory) {
      if (!entry.exists) {
        return 0;
      }
      for (const child of entry.list()) {
        size += deleteEntryQuiet(child);
      }
      entry.delete();
      return size;
    }

    if (!entry.exists) {
      return 0;
    }
    const raw = entry.size;
    size = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    entry.delete();
    return size;
  } catch {
    return size;
  }
}

/**
 * Clears VidoraX app cache only — never touches completed downloads in document storage.
 */
export async function clearVidoraXCache(): Promise<{ clearedBytes: number }> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  const cache = Paths.cache;
  if (!cache.exists) {
    return { clearedBytes: 0 };
  }

  let clearedBytes = 0;
  try {
    const entries = cache.list();
    for (const entry of entries) {
      clearedBytes += deleteEntryQuiet(entry);
    }
  } catch {
    // Best-effort cleanup.
  }

  return { clearedBytes };
}
