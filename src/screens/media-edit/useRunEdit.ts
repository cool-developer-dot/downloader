import { useCallback } from 'react';
import * as ReactNative from 'react-native';

import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { isEditRunning, type EditFailure, type EditJobState } from '@/media-edit/edit-job';
import { getEditJob } from '@/media-edit/edit-job-store';
import {
  editAvailability,
  editOutputTitle,
  editRequest,
  estimateEditBytes,
  hasRoomForEdit,
  trackPlan,
  type EditAvailability,
  type EditKind,
  type TrimRange,
} from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';

function announce(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

export const AVAILABILITY_KEYS: Record<Exclude<EditAvailability, 'ok'>, TranslationKey> = {
  'already-mp4': 'mediaEdit.alreadyMp4',
  'no-audio': 'mediaEdit.noAudio',
  'audio-source': 'mediaEdit.audioSource',
  'no-duration': 'mediaEdit.noDuration',
  'too-short': 'mediaEdit.tooShort',
};

const FAILURE_KEYS: Record<EditFailure, TranslationKey> = {
  busy: 'mediaEdit.busy',
  'no-space': 'mediaEdit.noSpace',
  refused: 'mediaEdit.refused',
  missing: 'mediaEdit.missing',
  failed: 'mediaEdit.failed',
};

const LABEL_KEYS: Record<EditKind, TranslationKey> = {
  trim: 'mediaEdit.trimmedLabel',
  mp4: 'mediaEdit.mp4Label',
  audio: 'mediaEdit.audioLabel',
};

/**
 * Starts one edit of a library item. Everything is re-checked right before acting: the item still exists, the edit
 * still makes sense, there is room for the output, and no other edit runs. Resolves with the job's final state.
 */
export function useRunEdit() {
  const { t } = useTranslation();
  return useCallback(
    async (id: string, kind: EditKind, trim?: { range: TrimRange; keyframeStart: boolean }): Promise<EditJobState | null> => {
      const job = getEditJob();
      const port = getEditPort();
      const engine = getV2Engine();
      if (!job || !port || !engine) {
        return null;
      }
      if (isEditRunning(job.state())) {
        announce(t('mediaEdit.busy'));
        return null;
      }
      const source = await engine.getLibraryItem(id).catch(() => null);
      if (!source) {
        announce(t('mediaEdit.missing'));
        return null;
      }
      const availability = editAvailability(kind, source);
      if (availability !== 'ok') {
        announce(t(AVAILABILITY_KEYS[availability]));
        return null;
      }
      const plan = trackPlan(kind, source, trim?.keyframeStart ?? false);
      const free = await port
        .getStorageStats()
        .then((stats) => stats.freeBytes)
        .catch(() => null);
      if (!hasRoomForEdit(free, estimateEditBytes(source, plan, trim?.range))) {
        announce(t('mediaEdit.noSpace'));
        return null;
      }
      const title = editOutputTitle(source.title, t(LABEL_KEYS[kind]));
      const result = await job.start(editRequest(kind, source, title, trim));
      if (result.phase === 'done') {
        announce(t('mediaEdit.done'));
      } else if (result.phase === 'cancelled') {
        announce(t('mediaEdit.cancelled'));
      } else if (result.phase === 'failed') {
        announce(t(FAILURE_KEYS[result.reason]));
      }
      return result;
    },
    [t],
  );
}
