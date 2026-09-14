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

export function useResumePrompt(input: {
  mediaId: string | null;
  isReady: boolean;
  /** Stale-resolution generation from player session. */
  resolveGeneration?: number;
  controller: PlayerController;
  /** Apply seek only when this mediaId still matches. */
  activeMediaId: string | null;
}): UseResumePromptResult {
  const [candidate, setCandidate] = useState<PlaybackSummary | null>(null);
  const [decision, setDecision] = useState<ResumeDecision>('pending');
  const appliedRef = useRef(false);
  const mediaSessionRef = useRef<string | null>(null);
  const genRef = useRef(input.resolveGeneration ?? 0);

  useEffect(() => {
    if (!input.mediaId) {
      setCandidate(null);
      setDecision('pending');
      appliedRef.current = false;
      mediaSessionRef.current = null;
      return;
    }
    const genChanged =
      input.resolveGeneration != null &&
      input.resolveGeneration !== genRef.current;
    if (mediaSessionRef.current !== input.mediaId || genChanged) {
      mediaSessionRef.current = input.mediaId;
      appliedRef.current = false;
      setDecision('pending');
      genRef.current = input.resolveGeneration ?? 0;

      const local = loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, input.mediaId);
      const merged = mergePlaybackStates(local, null);
      if (
        merged &&
        isResumeEligible({
          positionSeconds: merged.positionSeconds,
          durationSeconds: merged.durationSeconds,
          completed: merged.completed,
        })
      ) {
        setCandidate(merged);
        playbackLog('playback.resume_loaded', {
          mediaId: input.mediaId,
          revision: merged.clientRevision,
          pending: merged.pendingSync,
        });
      } else if (merged?.completed) {
        setCandidate(merged);
        setDecision('start_over');
      } else {
        setCandidate(null);
        setDecision('dismissed');
      }
    }
  }, [input.mediaId, input.resolveGeneration]);

  const applySeek = useCallback(
    (seconds: number): boolean => {
      if (
        !input.mediaId ||
        input.activeMediaId !== input.mediaId ||
        !input.isReady ||
        appliedRef.current
      ) {
        return false;
      }
      if (
        input.resolveGeneration != null &&
        input.resolveGeneration !== genRef.current
      ) {
        return false;
      }
      appliedRef.current = true;
      try {
        input.controller.seekTo(seconds);
        playbackLog('playback.resume_seek_applied', {
          mediaId: input.mediaId,
          position: Math.trunc(seconds),
          generation: genRef.current,
        });
        return true;
      } catch {
        appliedRef.current = false;
        return false;
      }
    },
    [
      input.mediaId,
      input.activeMediaId,
      input.isReady,
      input.controller,
      input.resolveGeneration,
    ],
  );

  useEffect(() => {
    if (
      !input.isReady ||
      appliedRef.current ||
      !input.mediaId ||
      input.activeMediaId !== input.mediaId
    ) {
      return;
    }
    if (
      input.resolveGeneration != null &&
      input.resolveGeneration !== genRef.current
    ) {
      return;
    }

    if (decision === 'start_over') {
      applySeek(0);
      return;
    }

    if (
      decision === 'pending' &&
      candidate &&
      isResumeEligible({
        positionSeconds: candidate.positionSeconds,
        durationSeconds: candidate.durationSeconds,
        completed: candidate.completed,
      })
    ) {
      setDecision('resume');
      applySeek(candidate.positionSeconds);
    }
  }, [
    input.isReady,
    decision,
    candidate,
    input.mediaId,
    input.activeMediaId,
    input.resolveGeneration,
    applySeek,
  ]);

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
