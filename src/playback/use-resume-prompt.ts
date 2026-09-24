/**
 * Automatic playback resume for PlayerScreen.
 * Eligible unfinished positions seek once the player is ready — no Resume sheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PlayerController } from '@/player/types';

import { PLAYBACK_LOCAL_NAMESPACE } from './constants';
import { isResumeEligible } from './domain/resume';
import { formatResumeLabel } from './domain/format';
import { mergePlaybackStates, type PlaybackSummary } from './domain/merge';
import { playbackLog } from './diagnostics';
import { loadPlaybackState } from './persistence';

export type ResumeDecision = 'pending' | 'resume' | 'start_over' | 'dismissed';

export type UseResumePromptResult = {
  /** Always false — Resume/Start Over sheet is bypassed for normal reopen. */
  visible: boolean;
  resumeLabel: string;
  candidate: PlaybackSummary | null;
  decision: ResumeDecision;
  chooseResume: () => void;
  chooseStartOver: () => void;
  dismiss: () => void;
};

/** The saved position read for one media id + player resolve generation. */
type LoadedResume = {
  mediaId: string | null;
  generation: number;
  candidate: PlaybackSummary | null;
  decision: ResumeDecision;
};

function canResumeFrom(summary: PlaybackSummary): boolean {
  return isResumeEligible({
    positionSeconds: summary.positionSeconds,
    durationSeconds: summary.durationSeconds,
    completed: summary.completed,
  });
}

function loadResume(
  mediaId: string | null,
  resolveGeneration: number | undefined,
): LoadedResume {
  const generation = resolveGeneration ?? 0;
  if (!mediaId) {
    return { mediaId: null, generation, candidate: null, decision: 'pending' };
  }
  const merged = mergePlaybackStates(
    loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, mediaId),
    null,
  );
  if (merged && canResumeFrom(merged)) {
    return { mediaId, generation, candidate: merged, decision: 'pending' };
  }
  if (merged?.completed) {
    return { mediaId, generation, candidate: merged, decision: 'start_over' };
  }
  return { mediaId, generation, candidate: null, decision: 'dismissed' };
}

/** A new media id, or a new resolve generation for the same one, starts a new resume session. */
function isStaleResume(
  loaded: LoadedResume,
  mediaId: string | null,
  resolveGeneration: number | undefined,
): boolean {
  if (loaded.mediaId !== mediaId) {
    return true;
  }
  return mediaId != null && resolveGeneration != null && resolveGeneration !== loaded.generation;
}

export function useResumePrompt(input: {
  mediaId: string | null;
  isReady: boolean;
  /** Stale-resolution generation from player session. */
  resolveGeneration?: number;
  controller: PlayerController;
  /** Apply seek only when this mediaId still matches. */
  activeMediaId: string | null;
}): UseResumePromptResult {
  const [loaded, setLoaded] = useState(() =>
    loadResume(input.mediaId, input.resolveGeneration),
  );
  const [decision, setDecision] = useState<ResumeDecision>(() => loaded.decision);
  const appliedRef = useRef(false);

  const candidate = loaded.candidate;
  // The player is showing this session's media and is ready for a seek.
  const seekable =
    input.isReady &&
    input.mediaId != null &&
    input.activeMediaId === input.mediaId &&
    (input.resolveGeneration == null || input.resolveGeneration === loaded.generation);

  if (isStaleResume(loaded, input.mediaId, input.resolveGeneration)) {
    const next = loadResume(input.mediaId, input.resolveGeneration);
    setLoaded(next);
    setDecision(next.decision);
  } else if (seekable && decision === 'pending' && candidate && canResumeFrom(candidate)) {
    setDecision('resume');
  }

  // Each resume session may seek once.
  useEffect(() => {
    appliedRef.current = false;
    if (loaded.mediaId && loaded.candidate && loaded.decision === 'pending') {
      playbackLog('playback.resume_loaded', {
        mediaId: loaded.mediaId,
        revision: loaded.candidate.clientRevision,
        pending: loaded.candidate.pendingSync,
      });
    }
  }, [loaded]);

  const applySeek = useCallback(
    (seconds: number): boolean => {
      if (!seekable || appliedRef.current) {
        return false;
      }
      appliedRef.current = true;
      try {
        input.controller.seekTo(seconds);
        playbackLog('playback.resume_seek_applied', {
          mediaId: input.mediaId ?? undefined,
          position: Math.trunc(seconds),
          generation: loaded.generation,
        });
        return true;
      } catch {
        appliedRef.current = false;
        return false;
      }
    },
    [seekable, input.controller, input.mediaId, loaded.generation],
  );

  useEffect(() => {
    if (!seekable || appliedRef.current) {
      return;
    }
    if (decision === 'start_over') {
      applySeek(0);
    } else if (decision === 'resume' && candidate) {
      applySeek(candidate.positionSeconds);
    }
  }, [seekable, decision, candidate, applySeek]);

  const chooseResume = useCallback(() => {
    if (!candidate || (decision !== 'pending' && decision !== 'resume')) {
      return;
    }
    setDecision('resume');
    applySeek(candidate.positionSeconds);
  }, [candidate, decision, applySeek]);

  const chooseStartOver = useCallback(() => {
    if (decision !== 'pending' && decision !== 'start_over') {
      return;
    }
    setDecision('start_over');
    applySeek(0);
  }, [decision, applySeek]);

  const dismiss = useCallback(() => {
    if (decision === 'pending') {
      setDecision('dismissed');
    }
  }, [decision]);

  return {
    visible: false,
    resumeLabel: candidate
      ? formatResumeLabel(candidate.positionSeconds)
      : 'Resume',
    candidate,
    decision,
    chooseResume,
    chooseStartOver,
    dismiss,
  };
}
