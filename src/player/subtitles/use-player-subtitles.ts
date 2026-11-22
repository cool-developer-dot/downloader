/**
 * P3: the Player's subtitles for the video playing now — the tracks to choose from, the one showing, its lines at
 * this moment, and the commands the sheets and options rows use.
 *
 * Two ways a subtitle is drawn:
 * - A track inside the video (MKV / MP4 text tracks, HLS / DASH subtitles): chosen through `player.subtitleTrack` and
 *   drawn by the player itself (Media3), styled by Android's caption settings. VidoraX cannot see its text, so it
 *   takes no sync offset and no VidoraX style.
 * - A subtitle file (loaded, or found next to the video): read and timed here, drawn by VidoraX's overlay — synced
 *   to `player.currentTime` ten times a second, shifted by the sync offset, styled by P4.
 * When a file (or Off) is chosen, the player's own track is turned off, so the two never show at once.
 */

import { useEventListener } from 'expo';
import type { SubtitleTrack, VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { activeCuesAt, createCueIndex, stepSubtitleOffset, subtitleTimeMs, type CueIndex } from './cues';
import { parseSubtitles, type AssFeature } from './parse-subtitles';
import { matchSidecarSubtitles, preferredSidecar } from './sidecar';
import { decodeSubtitleBytes, type ResolvedEncoding, type SubtitleEncoding } from './subtitle-encoding';
import { MAX_SUBTITLE_BYTES, listSidecarFiles, pickSubtitleFile, readSubtitleBytes } from './subtitle-files';
import { embeddedTrackLabel, subtitleFileLabel } from './subtitle-labels';
import {
  getVideoSubtitleRecord,
  setSubtitleAutoDetect,
  updateVideoSubtitleRecord,
  useSubtitleAutoDetect,
  useVideoSubtitleRecord,
} from './subtitle-preference';
import { addSubtitleFile, type SubtitleFileRef, type SubtitleSource } from './subtitle-record';

export type SubtitleOption = {
  key: string;
  source: SubtitleSource;
  label: string;
  kind: 'embedded' | 'file';
};

export type LoadedSubtitle = {
  key: string;
  index: CueIndex | null;
  encoding: ResolvedEncoding | null;
  unsupported: AssFeature[];
  failed: boolean;
};

export type PlayerSubtitles = {
  /** Every track to choose from: inside the video first, then files. */
  options: SubtitleOption[];
  /** What is showing (after the Player's own default when nothing was chosen). */
  current: SubtitleSource;
  currentKey: string;
  /** The label of what is showing; null when subtitles are off. */
  currentLabel: string | null;
  /** The file showing, when it is a file. */
  currentFile: SubtitleFileRef | null;
  /** The file showing, read and indexed (null while reading, or for a track inside the video). */
  loaded: LoadedSubtitle | null;
  offsetMs: number;
  /** The text showing now (one entry per cue; a cue may hold several lines). */
  lines: string[];
  autoDetect: boolean;
  /** The system file picker is open (the Player keeps picture-in-picture from starting meanwhile). */
  picking: boolean;
  select: (source: SubtitleSource) => void;
  turnOff: () => void;
  /** #589: the file picker; resolves to what happened and the file's name (for the toast). */
  load: () => Promise<{ kind: 'loaded' | 'canceled' | 'too_big' | 'not_subtitle' | 'failed'; name: string | null }>;
  stepOffset: (steps: number) => void;
  resetOffset: () => void;
  setEncoding: (encoding: SubtitleEncoding) => void;
  setAutoDetect: (on: boolean) => void;
};

export { MAX_SUBTITLE_BYTES };

const NO_LINES: string[] = [];

function sourceKey(source: SubtitleSource): string {
  if (source.kind === 'embedded') return `embedded:${source.id}`;
  if (source.kind === 'file') return `file:${source.fileId}`;
  return 'off';
}

function readTracks(player: VideoPlayer): SubtitleTrack[] {
  try {
    return [...player.availableSubtitleTracks];
  } catch {
    return [];
  }
}

function readNativeTrack(player: VideoPlayer): SubtitleTrack | null {
  try {
    return player.subtitleTrack ?? null;
  } catch {
    return null;
  }
}

/** A remembered track inside the video, on this load: by id, else by language and label, else by language. */
function matchEmbedded(tracks: readonly SubtitleTrack[], source: Extract<SubtitleSource, { kind: 'embedded' }>): SubtitleTrack | null {
  return (
    tracks.find((track) => trackId(track) === source.id) ??
    tracks.find((track) => source.language != null && track.language === source.language && track.label === source.label) ??
    tracks.find((track) => source.language != null && track.language === source.language) ??
    null
  );
}

/** expo-video's id for a track; a track without one is known by its language and label. */
function trackId(track: SubtitleTrack): string {
  return track.id ?? `${track.language ?? ''}|${track.label ?? ''}`;
}

/** Shows `track` (or no track) in the player's own subtitle view, unless it already does. */
function applyNativeTrack(player: VideoPlayer, track: SubtitleTrack | null): void {
  const now = readNativeTrack(player);
  if ((track ? trackId(track) : null) === (now ? trackId(now) : null)) {
    return;
  }
  try {
    player.subtitleTrack = track;
  } catch {
    // A released player: nothing to change.
  }
}

function embeddedSource(track: SubtitleTrack): SubtitleSource {
  return { kind: 'embedded', id: trackId(track), language: track.language ?? null, label: track.label ?? null };
}

export function usePlayerSubtitles(player: VideoPlayer, mediaId: string | null): PlayerSubtitles {
  const { t, language: appLanguage } = useTranslation();
  const record = useVideoSubtitleRecord(mediaId);
  const autoDetect = useSubtitleAutoDetect();

  // ── Tracks inside the video ─────────────────────────────────────────────────────────────────────────────────────
  // Kept per video: after Previous / Next the list starts empty until the new video's tracks are reported.
  const [trackState, setTrackState] = useState<{ mediaId: string | null; embedded: SubtitleTrack[]; native: SubtitleTrack | null }>(
    () => ({ mediaId, embedded: readTracks(player), native: readNativeTrack(player) }),
  );
  const ownTracks = trackState.mediaId === mediaId ? trackState : null;
  const embedded = useMemo(() => ownTracks?.embedded ?? [], [ownTracks]);
  const nativeTrack = ownTracks?.native ?? null;
  const updateTracks = useCallback(
    (change: { embedded?: SubtitleTrack[]; native?: SubtitleTrack | null }) => {
      setTrackState((previous) => {
        const base = previous.mediaId === mediaId ? previous : { mediaId, embedded: [], native: null };
        return { ...base, ...change };
      });
    },
    [mediaId],
  );
  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    updateTracks({ embedded: [...availableSubtitleTracks] });
  });
  useEventListener(player, 'sourceLoad', ({ availableSubtitleTracks }) => {
    updateTracks({ embedded: [...availableSubtitleTracks] });
  });
  useEventListener(player, 'subtitleTrackChange', ({ subtitleTrack }) => {
    updateTracks({ native: subtitleTrack ?? null });
  });

  // ── Files next to the video (#590) ──────────────────────────────────────────────────────────────────────────────
  // Listing the folder is a quick synchronous read of VidoraX's own library folder; it runs again when the video,
  // the switch, or the download's file changes.
  const libraryUri = useDownloadsStore((state) => (mediaId ? (state.transferById[mediaId]?.localUri ?? null) : null));
  const detected = useMemo<SubtitleFileRef[]>(() => {
    if (!autoDetect || !mediaId) {
      return [];
    }
    const listing = listSidecarFiles(libraryUri);
    if (!listing) {
      return [];
    }
    const byName = new Map(listing.files.map((file) => [file.name, file.uri]));
    return matchSidecarSubtitles(
      listing.videoName,
      listing.files.map((file) => file.name),
    ).map((match) => ({
      id: `detected:${match.name}`,
      name: match.name,
      uri: byName.get(match.name)!,
      format: match.format,
      language: match.language,
      encoding: 'auto' as const,
      origin: 'detected' as const,
    }));
  }, [autoDetect, libraryUri, mediaId]);

  // ── All files: the record's (loaded, or detected and chosen once), then newly detected ones ─────────────────────
  const files = useMemo(() => {
    const known = new Set(record.files.map((file) => file.uri));
    return [...record.files, ...detected.filter((file) => !known.has(file.uri))];
  }, [detected, record.files]);

  // ── What shows ──────────────────────────────────────────────────────────────────────────────────────────────────
  const current: SubtitleSource = useMemo(() => {
    const chosen = record.primary;
    if (chosen) {
      if (chosen.kind !== 'file' || files.some((file) => file.id === chosen.fileId)) {
        return chosen;
      }
      return { kind: 'off' };
    }
    // Nothing chosen for this video: a track the video turns on by itself, else a file found next to it.
    if (nativeTrack) {
      return embeddedSource(nativeTrack);
    }
    const found = autoDetect ? preferredSidecar(detected, appLanguage) : null;
    return found ? { kind: 'file', fileId: found.id } : { kind: 'off' };
  }, [appLanguage, autoDetect, detected, files, nativeTrack, record.primary]);
  const currentKey = sourceKey(current);
  const currentFile = current.kind === 'file' ? (files.find((file) => file.id === current.fileId) ?? null) : null;

  // The player draws a track inside the video only when one is chosen; otherwise its own subtitles are off. A chosen
  // track not listed yet (the video is still loading) is waited for rather than switched off.
  const wantedEmbedded =
    current.kind === 'embedded'
      ? (matchEmbedded(embedded, current) ?? (nativeTrack && trackId(nativeTrack) === current.id ? nativeTrack : null))
      : null;
  const waitingForTrack = current.kind === 'embedded' && wantedEmbedded == null;
  useEffect(() => {
    if (!waitingForTrack) {
      applyNativeTrack(player, wantedEmbedded);
    }
  }, [player, waitingForTrack, wantedEmbedded, nativeTrack]);

  // ── The file showing: read, decoded, parsed, indexed ────────────────────────────────────────────────────────────
  const fileUri = currentFile?.uri ?? null;
  const fileEncoding = currentFile?.encoding ?? 'auto';
  const fileFormat = currentFile?.format ?? 'srt';
  const fileKey = fileUri ? `${fileUri}|${fileEncoding}|${fileFormat}` : null;
  const [loaded, setLoaded] = useState<LoadedSubtitle | null>(null);
  useEffect(() => {
    if (!fileUri || !fileKey) {
      return;
    }
    let live = true;
    readSubtitleBytes(fileUri)
      .then((bytes) => {
        const decoded = decodeSubtitleBytes(bytes, fileEncoding);
        const parsed = parseSubtitles(decoded.text, fileFormat);
        if (live) {
          setLoaded({
            key: fileKey,
            index: createCueIndex(parsed.cues),
            encoding: decoded.encoding,
            unsupported: parsed.unsupported,
            failed: false,
          });
        }
      })
      .catch(() => {
        if (live) {
          setLoaded({ key: fileKey, index: null, encoding: null, unsupported: [], failed: true });
        }
      });
    return () => {
      live = false;
    };
  }, [fileEncoding, fileFormat, fileKey, fileUri]);

  // ── The lines showing now ───────────────────────────────────────────────────────────────────────────────────────
  const offsetMs = record.offsetMs;
  const index = loaded && loaded.key === fileKey ? loaded.index : null;
  const [shown, setShown] = useState<{ index: CueIndex | null; lines: string[] }>({ index: null, lines: [] });
  useEffect(() => {
    if (!index) {
      return;
    }
    let last = '';
    const tick = () => {
      let seconds: number;
      try {
        seconds = player.currentTime;
      } catch {
        return;
      }
      const cues = activeCuesAt(index, subtitleTimeMs(seconds, offsetMs));
      const key = cues.map((cue) => `${cue.startMs}:${cue.text}`).join('|');
      if (key !== last) {
        last = key;
        setShown({ index, lines: cues.map((cue) => cue.text) });
      }
    };
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [index, offsetMs, player]);

  // ── Options ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const options = useMemo<SubtitleOption[]>(
    () => [
      ...embedded.map((track, position) => ({
        key: `embedded:${trackId(track)}`,
        source: embeddedSource(track),
        label: embeddedTrackLabel(t, track, position),
        kind: 'embedded' as const,
      })),
      ...files.map((file) => ({
        key: `file:${file.id}`,
        source: { kind: 'file', fileId: file.id } as SubtitleSource,
        label: subtitleFileLabel(t, file),
        kind: 'file' as const,
      })),
    ],
    [embedded, files, t],
  );
  const currentLabel =
    current.kind === 'off'
      ? null
      : current.kind === 'file'
        ? currentFile
          ? subtitleFileLabel(t, currentFile)
          : null
        : (options.find((option) => option.key === currentKey)?.label ??
          embeddedTrackLabel(t, { label: current.label, language: current.language }, 0));

  // ── Commands ────────────────────────────────────────────────────────────────────────────────────────────────────
  const select = useCallback(
    (source: SubtitleSource) => {
      const previous = getVideoSubtitleRecord(mediaId);
      if (source.kind !== 'file') {
        updateVideoSubtitleRecord(mediaId, () => ({ ...previous, primary: source }));
        return;
      }
      // A detected file is remembered once chosen, so it is offered again even if auto-detect is turned off.
      const file = files.find((candidate) => candidate.id === source.fileId);
      const added =
        file && !previous.files.some((existing) => existing.id === file.id)
          ? addSubtitleFile(previous, file)
          : { record: previous, dropped: [] };
      updateVideoSubtitleRecord(mediaId, () => ({ ...added.record, primary: source }), added.dropped);
    },
    [files, mediaId],
  );

  const turnOff = useCallback(() => select({ kind: 'off' }), [select]);

  const [picking, setPicking] = useState(false);
  const load = useCallback(async () => {
    setPicking(true);
    try {
      const outcome = await pickSubtitleFile();
      if (outcome.kind !== 'picked') {
        return { kind: outcome.kind, name: null };
      }
      const added = addSubtitleFile(getVideoSubtitleRecord(mediaId), outcome.ref);
      updateVideoSubtitleRecord(
        mediaId,
        () => ({ ...added.record, primary: { kind: 'file', fileId: outcome.ref.id } }),
        added.dropped,
      );
      return { kind: 'loaded' as const, name: outcome.ref.name };
    } finally {
      setPicking(false);
    }
  }, [mediaId]);

  const stepOffset = useCallback(
    (steps: number) => {
      updateVideoSubtitleRecord(mediaId, (previous) => ({ ...previous, offsetMs: stepSubtitleOffset(previous.offsetMs, steps) }));
    },
    [mediaId],
  );
  const resetOffset = useCallback(() => {
    updateVideoSubtitleRecord(mediaId, (previous) => ({ ...previous, offsetMs: 0 }));
  }, [mediaId]);

  const setEncoding = useCallback(
    (encoding: SubtitleEncoding) => {
      if (!currentFile) {
        return;
      }
      const added = addSubtitleFile(getVideoSubtitleRecord(mediaId), { ...currentFile, encoding });
      updateVideoSubtitleRecord(
        mediaId,
        () => ({ ...added.record, primary: { kind: 'file', fileId: currentFile.id } }),
        added.dropped,
      );
    },
    [currentFile, mediaId],
  );

  return {
    options,
    current,
    currentKey,
    currentLabel,
    currentFile,
    loaded: loaded && loaded.key === fileKey ? loaded : null,
    offsetMs,
    lines: index && shown.index === index ? shown.lines : NO_LINES,
    autoDetect,
    picking,
    select,
    turnOff,
    load,
    stepOffset,
    resetOffset,
    setEncoding,
    setAutoDetect: setSubtitleAutoDetect,
  };
}
