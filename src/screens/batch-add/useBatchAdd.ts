import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addLinkFromBatch, type BatchLinkResult } from '@/browser/media-actions/batch-add.service';
import { pendingNavigationService } from '@/browser/services';
import { classifyIntakeLink } from '@/browser/services/link-intake';
import { useBrowserStore } from '@/browser/stores';
import { batchLinksFromText } from '@/downloads/bulk/batch-text';
import { linkRuleSkip } from '@/downloads/bulk/link-rules';
import { looksLikePlaylistUrl, parsePlaylist } from '@/downloads/bulk/playlist-parse';
import { navigation, routePaths } from '@/navigation';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import { useSettingsStore } from '@/store/settings';

import { batchAddPrefill } from './batch-add-prefill';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 10_000;
const MAX_PLAYLISTS_PER_LOAD = 5;

export type BatchRow = {
  url: string;
  /** #347: mirrors given on the link's line (`link | mirror`); none = today's row. */
  mirrors: string[];
  status: 'pending' | 'running' | 'done';
  result: BatchLinkResult | null;
};

export type PlaylistNotice = { kind: 'loaded'; count: number } | { kind: 'stream' | 'none' | 'failed' } | null;

async function readPlaylist(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_PLAYLIST_BYTES ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type BatchStartOptions = {
  /** A subset of `links` to run (the Playlist screen's selection); the whole list by default. */
  links?: readonly string[];
  /** Playlist "Cooldown between files": the wait before each link after the first. 0 by default. */
  cooldownMs?: number;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/**
 * Batch Add (#292) and Import Links from File (#293), with patterns (#485), include/exclude rules (#505) and
 * playlists with a choice of items (#368, #369). Links run one at a time; leaving the screen stops the run (a link
 * already handed to the engine stays queued there).
 */
export function useBatchAdd() {
  // Links the Page Link Grabber (#484) found on a page arrive here; the user still chooses and starts the run.
  const [text, setText] = useState(() => batchAddPrefill.take() ?? '');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [fileError, setFileError] = useState<'too-large' | 'unreadable' | null>(null);
  const [unselected, setUnselected] = useState<ReadonlySet<string>>(() => new Set());
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistNotice, setPlaylistNotice] = useState<PlaylistNotice>(null);
  const rules = useSettingsStore((state) => state.linkRules);
  const abortRef = useRef<AbortController | null>(null);
  // Set synchronously: a second tap before the next render must not start a second run.
  const runningRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const parsed = useMemo(() => batchLinksFromText(text), [text]);
  const ruleSkipped = useMemo(() => parsed.links.filter((url) => linkRuleSkip(url, rules) !== null), [parsed.links, rules]);
  /** Every link the text stands for that the rules let through, chosen or not. */
  const candidates = useMemo(() => parsed.links.filter((url) => linkRuleSkip(url, rules) === null), [parsed.links, rules]);
  const links = useMemo(() => candidates.filter((url) => !unselected.has(url)), [candidates, unselected]);
  const playlistLinks = useMemo(() => parsed.links.filter(looksLikePlaylistUrl), [parsed.links]);

  const toggle = useCallback((url: string) => {
    setUnselected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => setUnselected(new Set()), []);
  const selectNone = useCallback(() => setUnselected(new Set(candidates)), [candidates]);

  const start = useCallback(async (options?: BatchStartOptions) => {
    if (runningRef.current) {
      return;
    }
    const wanted = options?.links;
    const chosen = wanted ? links.filter((url) => wanted.includes(url)) : links;
    const queue = chosen.map((url) => ({ url, mirrors: parsed.mirrors[url] ?? [] }));
    if (queue.length === 0) {
      return;
    }
    const cooldownMs = Math.max(0, options?.cooldownMs ?? 0);
    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRows(queue.map(({ url, mirrors }) => ({ url, mirrors, status: 'pending', result: null })));
    for (let index = 0; index < queue.length; index += 1) {
      if (index > 0 && cooldownMs > 0) {
        await wait(cooldownMs, controller.signal);
      }
      if (controller.signal.aborted) {
        break;
      }
      setRows((current) => current.map((row, i) => (i === index ? { ...row, status: 'running' } : row)));
      let result: BatchLinkResult;
      try {
        result = await addLinkFromBatch(queue[index]!.url, controller.signal, {
          rules,
          title: titles[queue[index]!.url] ?? null,
          mirrors: queue[index]!.mirrors,
        });
      } catch {
        result = { url: queue[index]!.url, outcome: 'needs-review', detail: 'ERROR', title: null, downloadId: null };
      }
      // Stop while this link was being checked: it was never decided, so it waits like the links after it.
      if (controller.signal.aborted && result.outcome === 'needs-review') {
        setRows((current) => current.map((row, i) => (i === index ? { ...row, status: 'pending', result: null } : row)));
        break;
      }
      setRows((current) => current.map((row, i) => (i === index ? { ...row, status: 'done', result } : row)));
    }
    runningRef.current = false;
    setRunning(false);
  }, [links, parsed.mirrors, rules, titles]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const openInBrowser = useCallback((url: string) => {
    // A History-style open: the page loads in the browser, where detection and the usual checks decide.
    pendingNavigationService.set(url, { targetTabId: useBrowserStore.getState().activeTabId });
    navigation.navigate(routePaths.browser);
  }, []);

  /** #368: each playlist link in the text is replaced by the files it lists (an HLS stream stays one link). */
  const loadPlaylists = useCallback(async () => {
    if (playlistBusy) return;
    setPlaylistBusy(true);
    setPlaylistNotice(null);
    let added = 0;
    let stream = false;
    let failed = false;
    const replacements = new Map<string, string[]>();
    const newTitles: Record<string, string> = {};
    for (const url of playlistLinks.slice(0, MAX_PLAYLISTS_PER_LOAD)) {
      if (classifyIntakeLink(url) !== 'ok') continue;
      const body = await readPlaylist(url);
      if (body === null) {
        failed = true;
        continue;
      }
      const result = parsePlaylist(body, url);
      if (result.kind === 'hls') {
        stream = true;
        continue;
      }
      if (result.kind === 'playlist') {
        replacements.set(url, result.entries.map((entry) => entry.url));
        for (const entry of result.entries) {
          if (entry.title) newTitles[entry.url] = entry.title;
        }
        added += result.entries.length;
      }
    }
    if (replacements.size > 0) {
      setText((current) =>
        current
          .split(/\r?\n/)
          .flatMap((line) => replacements.get(line.trim()) ?? [line])
          .join('\n'),
      );
      setTitles((current) => ({ ...current, ...newTitles }));
    }
    setPlaylistNotice(
      added > 0 ? { kind: 'loaded', count: added } : stream ? { kind: 'stream' } : failed ? { kind: 'failed' } : { kind: 'none' },
    );
    setPlaylistBusy(false);
  }, [playlistBusy, playlistLinks]);

  const importFromFile = useCallback(async () => {
    setFileError(null);
    try {
      // The system file picker is part of this action: App Lock does not relock for it (fix/app-lock-grace).
      const picked = await withExpectedSystemScreen(() => File.pickFileAsync({ mimeTypes: ['text/plain', 'text/*'] }));
      if (picked.canceled || !picked.result) {
        return;
      }
      const file = picked.result;
      if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
        setFileError('too-large');
        return;
      }
      const content = await file.text();
      setText((current) => (current.trim() ? `${current.trim()}\n${content.slice(0, MAX_FILE_BYTES)}` : content.slice(0, MAX_FILE_BYTES)));
    } catch {
      setFileError('unreadable');
    }
  }, []);

  return {
    text,
    setText,
    links,
    candidates,
    truncated: parsed.truncated,
    ruleSkipped,
    unselected,
    toggle,
    selectAll,
    selectNone,
    titles,
    playlistLinks,
    playlistBusy,
    playlistNotice,
    loadPlaylists,
    rows,
    running,
    start,
    stop,
    openInBrowser,
    importFromFile,
    fileError,
  };
}
