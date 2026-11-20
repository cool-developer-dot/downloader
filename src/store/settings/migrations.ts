import type { SettingsState } from './types';

/**
 * 1.2.0: the client approved live recording, so it left beta and is on by default. Settings saved before then (no
 * `liveRecordingApproved` flag) are switched on once; after that the user's own choice is kept.
 */
export function liveRecordingMigration(
  persisted: Partial<SettingsState>,
): Pick<SettingsState, 'liveRecording' | 'liveRecordingApproved'> | Record<string, never> {
  return persisted.liveRecordingApproved === true ? {} : { liveRecording: true, liveRecordingApproved: true };
}
