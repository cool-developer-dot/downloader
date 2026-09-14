import { useCallback, useEffect, useRef } from 'react';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';
import { isSameDocumentUrl } from '@/media-detection/utils';

import {
  PAGE_RESOLUTION_TIMING,
  isSocialPlatform,
  tryCompletePageResolutionFromStore,
} from '../services/page-media-resolution.service';
import {
  pendingMediaResolutionService,
  type PendingMediaResolution,
} from '../services/pending-media-resolution.service';
import { logPasteMediaDiagnostic } from '../services/paste-media-diagnostics.service';
import {
  logPageFlow,
  safePageHostname,
} from '../services/page-flow-diagnostics.service';
import { logIgRuntime } from '../services/ig-runtime-diagnostics.service';
import { useMediaDetectionStore } from '../stores';

export type PendingMediaResolutionHandlers = {
  onResolved: (result: Awaited<
    ReturnType<typeof tryCompletePageResolutionFromStore>
  > & { ok: true }) => void;
  onWaitingPlayback?: (session: PendingMediaResolution) => void;
  onTimeout?: (session: PendingMediaResolution) => void;
};

/**
 * Browser-side watcher for Paste Link page-resolution sessions.
 * Reuses the visible Browser WebView — one-shot load, no duplicate reloads.
 */
export function usePendingMediaResolution(
  handlers: PendingMediaResolutionHandlers,
): void {
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const isLoading = useBrowserStore((s) => s.isLoading);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const completingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackHintSentRef = useRef(false);
  const watchedSessionIdRef = useRef<string | null>(null);
  const prevDetectedCountRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const queueNavigationOnce = useCallback(
    (session: PendingMediaResolution) => {
      if (!session.canonicalUrl) {
        return;
      }
      if (pendingMediaResolutionService.matchesPageUrl(currentUrl)) {
        return;
      }
      const peek = pendingNavigationService.peek();
      if (peek && isSameDocumentUrl(peek.url, session.canonicalUrl)) {
        return;
      }
      pendingNavigationService.set(session.canonicalUrl, {
        targetTabId: useBrowserStore.getState().activeTabId,
      });
      logPageFlow('navigation_queued', {
        sessionId: session.id,
        hostname: safePageHostname(session.canonicalUrl),
        source: 'browser_watcher',
      });
    },
    [currentUrl],
  );

  const attemptComplete = useCallback(async () => {
    const session = pendingMediaResolutionService.get();
    if (!session || completingRef.current) {
      return;
    }
    if (
      session.status === 'verified' ||
      session.status === 'failed' ||
      session.status === 'timeout'
    ) {
      return;
    }

    completingRef.current = true;
    try {
      const result = await tryCompletePageResolutionFromStore(session);
      if (result?.ok) {
        clearTimers();
        logPageFlow('resolved', {
          sessionId: session.id,
          hostname: safePageHostname(result.mediaUrl),
        });
        logPageFlow('quality_open', {
          sessionId: session.id,
          platform: session.platform,
        });
        logIgRuntime('quality_open', {
          platform: session.platform,
          hostname: safeHostname(result.mediaUrl),
        });
        handlersRef.current.onResolved(result);
        pendingMediaResolutionService.clear();
        watchedSessionIdRef.current = null;
        return;
      }
    } finally {
      completingRef.current = false;
    }
  }, [clearTimers]);

  const beginWatching = useCallback(
    (session: PendingMediaResolution) => {
      if (watchedSessionIdRef.current === session.id && pollRef.current) {
        return;
      }

      watchedSessionIdRef.current = session.id;
      clearTimers();
      playbackHintSentRef.current = false;

      queueNavigationOnce(session);
      pendingMediaResolutionService.update({ status: 'waiting_media' });

      const initialWaitMs = isSocialPlatform(session)
        ? PAGE_RESOLUTION_TIMING.earlyPlaybackHintMs
        : PAGE_RESOLUTION_TIMING.waitForMediaMs;

      pollRef.current = setInterval(() => {
        void attemptComplete();
      }, PAGE_RESOLUTION_TIMING.pollIntervalMs);

      timeoutRef.current = setTimeout(() => {
        const active = pendingMediaResolutionService.get();
        if (!active || active.id !== session.id) {
          return;
        }
        pendingMediaResolutionService.update({ status: 'waiting_playback' });
        if (!playbackHintSentRef.current) {
          playbackHintSentRef.current = true;
          logPageFlow('waiting_media', {
            sessionId: active.id,
            phase: 'playback_hint',
          });
          logPasteMediaDiagnostic('waiting_playback', {
            platform: active.platform,
          });
          logIgRuntime('playback', { platform: active.platform, waiting: true });
          handlersRef.current.onWaitingPlayback?.(active);
        }

        timeoutRef.current = setTimeout(() => {
          const stillActive = pendingMediaResolutionService.get();
          if (!stillActive || stillActive.id !== session.id) {
            return;
          }
          pendingMediaResolutionService.timeout();
          clearTimers();
          logPageFlow('timeout', { sessionId: stillActive.id });
          handlersRef.current.onTimeout?.(stillActive);
        }, PAGE_RESOLUTION_TIMING.playbackWaitMs);
      }, initialWaitMs);
    },
    [attemptComplete, clearTimers, queueNavigationOnce],
  );

  useEffect(() => {
    const session = pendingMediaResolutionService.get();
    if (session && session.status !== 'verified' && session.status !== 'failed') {
      beginWatching(session);
    }

    return pendingMediaResolutionService.subscribe(() => {
      const next = pendingMediaResolutionService.get();
      if (!next || next.status === 'verified' || next.status === 'failed') {
        return;
      }
      if (next.id !== watchedSessionIdRef.current) {
        beginWatching(next);
      }
    });
  }, [beginWatching]);

  useEffect(() => {
    const session = pendingMediaResolutionService.get();
    if (!session?.canonicalUrl) {
      return;
    }

    if (isBrowserHomeUrl(currentUrl)) {
      return;
    }

    if (
      pendingMediaResolutionService.matchesPageUrl(currentUrl) &&
      !isLoading
    ) {
      logPasteMediaDiagnostic('browser_loaded', {
        hostname: safeHostname(currentUrl),
        platform: session.platform,
      });
      logPageFlow('browser_loaded', {
        sessionId: session.id,
        hostname: safePageHostname(currentUrl),
      });
      logIgRuntime('navigation', {
        hostname: safeHostname(currentUrl),
        platform: session.platform,
      });
      pendingMediaResolutionService.update({ status: 'waiting_media' });
      void attemptComplete();
    }
  }, [currentUrl, isLoading, attemptComplete]);

  useEffect(() => {
    return useMediaDetectionStore.subscribe((state) => {
      const prev = prevDetectedCountRef.current;
      const next = state.detectedMedia.length;
      if (next > prev) {
        logPageFlow('candidate', {
          count: next,
          sessionId: pendingMediaResolutionService.get()?.id ?? null,
        });
        logIgRuntime('store_insert', { count: next });
      }
      prevDetectedCountRef.current = next;
      if (next !== prev) {
        void attemptComplete();
      }
    });
  }, [attemptComplete]);

  useEffect(() => clearTimers, [clearTimers]);
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
