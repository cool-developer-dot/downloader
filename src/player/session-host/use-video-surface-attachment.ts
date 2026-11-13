import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useSettingsStore } from '@/store/settings';

import { subscribeActivityStopped } from '../picture-in-picture';

import { createVideoSurfaceAttachment, type VideoSurfaceAttachment } from './video-surface-attachment';

const attachment = createVideoSurfaceAttachment();
let listening = false;

function ensureListening(): void {
  if (listening) {
    return;
  }
  listening = true;
  subscribeActivityStopped(() => attachment.onActivityStopped(useSettingsStore.getState().backgroundPlayback));
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      attachment.onAppActive();
    }
  });
}

function subscribe(listener: () => void): () => void {
  ensureListening();
  return attachment.subscribe(listener);
}

/** See video-surface-attachment.ts: render the VideoView only while `attached`. */
export function useVideoSurfaceAttachment(): VideoSurfaceAttachment {
  return useSyncExternalStore(subscribe, attachment.get, attachment.get);
}
