/**
 * P7 #629 — which library videos an imported playlist's lines are. Pure (tested under Node).
 *
 * 1. **By path.** A line and a video's file match when their last folders and file name agree, at least two segments
 *    (`Movies/VidoraX/Clip.mp4` matches a video stored at `…/Movies/VidoraX/Clip.mp4`, or the other way round). The
 *    video's path is where VidoraX plays it from (its file, or the document of a folder the user picked).
 * 2. **By file name.** Otherwise the line's file name against the video's file name, extension included (`clip.mp4`
 *    does not match `clip.mkv`: those can be different videos).
 *
 * Both ignore case (and Unicode composition, where the engine can normalise), so `CLIP.MP4` matches `clip.mp4`; Urdu
 * names match as written. When two videos share a name, a playable one is taken first, then the first in the list.
 * A video already matched by an earlier line is not added twice (a playlist holds each video once): such lines are
 * counted as duplicates. Lines that match nothing are returned in order, for the user to see.
 */

import { locationSegments, type M3uEntry } from './m3u';

export type ImportCandidate = {
  id: string;
  /** The video's file name (with extension). */
  fileName: string;
  /** Where the file is (a `file://` / `content://` URI or a path); null when not known. */
  path: string | null;
  /** Can be played now (not missing). */
  playable: boolean;
};

export type ImportMatch<C extends ImportCandidate = ImportCandidate> = {
  entry: M3uEntry;
  candidate: C;
  by: 'path' | 'name';
};

export type ImportMatchResult<C extends ImportCandidate = ImportCandidate> = {
  /** In the file's order. */
  matched: ImportMatch<C>[];
  /** Lines that match no video, in the file's order. */
  notFound: M3uEntry[];
  /** Lines that matched a video an earlier line already matched. */
  duplicates: number;
};

function fold(text: string): string {
  let value = text.toLowerCase();
  try {
    value = value.normalize('NFC');
  } catch {
    // An engine without normalize: compare as written.
  }
  return value;
}

function foldedSegments(location: string | null): string[] {
  if (!location) {
    return [];
  }
  return (locationSegments(location) ?? []).map(fold);
}

/** The shorter path is the end of the longer one, and they share at least two segments (a folder and the name). */
function sameTail(a: readonly string[], b: readonly string[]): boolean {
  const n = Math.min(a.length, b.length);
  if (n < 2) {
    return false;
  }
  for (let i = 1; i <= n; i += 1) {
    if (a[a.length - i] !== b[b.length - i]) {
      return false;
    }
  }
  return true;
}

export function matchImportEntries<C extends ImportCandidate>(
  entries: readonly M3uEntry[],
  candidates: readonly C[],
): ImportMatchResult<C> {
  // Playable first, otherwise the given order: the pick when two videos share a name.
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index, segments: foldedSegments(candidate.path) }))
    .sort((a, b) => Number(b.candidate.playable) - Number(a.candidate.playable) || a.index - b.index);
  const byName = new Map<string, typeof ordered>();
  for (const item of ordered) {
    const key = fold(item.candidate.fileName.trim());
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(item);
    else byName.set(key, [item]);
  }

  const lineSegments = entries.map((entry) => foldedSegments(entry.location));
  const found = new Array<{ candidate: C; by: 'path' | 'name' } | null>(entries.length).fill(null);
  const claimed = new Set<string>();
  const duplicateLines = new Set<number>();

  // 1. By path (claims its video first, so a name match below can't take it from a line that names its folder).
  entries.forEach((_entry, index) => {
    const segments = lineSegments[index]!;
    if (segments.length < 2) return;
    const hit = ordered.find((item) => sameTail(item.segments, segments));
    if (!hit) return;
    if (claimed.has(hit.candidate.id)) {
      duplicateLines.add(index);
      return;
    }
    claimed.add(hit.candidate.id);
    found[index] = { candidate: hit.candidate, by: 'path' };
  });

  // 2. By file name, for the rest: a video no line has taken yet, else it is the same video listed twice.
  entries.forEach((_entry, index) => {
    if (found[index] || duplicateLines.has(index)) return;
    const segments = lineSegments[index]!;
    const name = segments[segments.length - 1];
    const sameName = name ? byName.get(name) : undefined;
    if (!sameName || sameName.length === 0) return;
    const free = sameName.find((item) => !claimed.has(item.candidate.id));
    if (!free) {
      duplicateLines.add(index);
      return;
    }
    claimed.add(free.candidate.id);
    found[index] = { candidate: free.candidate, by: 'name' };
  });

  const matched: ImportMatch<C>[] = [];
  const notFound: M3uEntry[] = [];
  entries.forEach((entry, index) => {
    const hit = found[index];
    if (hit) matched.push({ entry, candidate: hit.candidate, by: hit.by });
    else if (!duplicateLines.has(index)) notFound.push(entry);
  });
  return { matched, notFound, duplicates: duplicateLines.size };
}
