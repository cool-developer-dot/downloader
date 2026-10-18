import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addLinkFromBatch, type BatchLinkResult } from '@/browser/media-actions/batch-add.service';
import { pendingNavigationService } from '@/browser/services';
import { extractLinks } from '@/browser/services/link-intake';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

const MAX_FILE_BYTES = 512 * 1024;

export type BatchRow = { url: string; status: 'pending' | 'running' | 'done'; result: BatchLinkResult | null };

/**
 * Batch Add (#292) and Import Links from File (#293). Links run one at a time; leaving the screen stops the run
 * (a link already handed to the engine stays queued there).
 */
export function useBatchAdd() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [fileError, setFileError] = useState<'too-large' | 'unreadable' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set synchronously: a second tap before the next render must not start a second run.
  const runningRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const links = useMemo(() => extractLinks(text), [text]);

  const start = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    const queue = links;
    if (queue.length === 0) {
      return;
    }
    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRows(queue.map((url) => ({ url, status: 'pending', result: null })));
    for (let index = 0; index < queue.length; index += 1) {
      if (controller.signal.aborted) {
        break;
      }
      setRows((current) => current.map((row, i) => (i === index ? { ...row, status: 'running' } : row)));
      let result: BatchLinkResult;
      try {
        result = await addLinkFromBatch(queue[index]!, controller.signal);
      } catch {
        result = { url: queue[index]!, outcome: 'needs-review', detail: 'ERROR', title: null, downloadId: null };
      }
      setRows((current) => current.map((row, i) => (i === index ? { ...row, status: 'done', result } : row)));
    }
    runningRef.current = false;
    setRunning(false);
  }, [links]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const openInBrowser = useCallback((url: string) => {
    // A History-style open: the page loads in the browser, where detection and the usual checks decide.
    pendingNavigationService.set(url, { targetTabId: useBrowserStore.getState().activeTabId });
    navigation.navigate(routePaths.browser);
  }, []);

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

  return { text, setText, links, rows, running, start, stop, openInBrowser, importFromFile, fileError };
}
