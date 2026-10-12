/**
 * F6 live recording, the JavaScript half: how a recording's length reads, and the "Maximum length" choices. The
 * engine records (`kind: 'live'`); these only present it. Pure — no native imports.
 */

/** A recording's length as a clock: "0:07", "12:34", "1:15:03" — Latin digits in every language, like the engine's notification. */
export function formatRecordedTime(ms: number | null | undefined): string {
  const seconds = Math.max(0, Math.floor((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** "Recording · 12:34 · 85 MB". Left-to-right marks keep the clock and the size in order after an Urdu label. */
export function recordingLine(label: string, recordedMs: number | null | undefined, size: string | null): string {
  return [label, `‎${formatRecordedTime(recordedMs)}‎`, size ? `‎${size}‎` : null]
    .filter(Boolean)
    .join(' · ');
}

/** A "Maximum length" choice as "30 min" / "1 h" / "2 h": whole hours read as hours (one hour is singular in Urdu). */
export function maxLengthLabel(
  minutes: number,
  t: (
    key: 'settings.liveRecordingMinutes' | 'settings.liveRecordingHours' | 'settings.liveRecordingOneHour',
    params: { count: number },
  ) => string,
): string {
  if (minutes === 60) {
    return t('settings.liveRecordingOneHour', { count: 1 });
  }
  return minutes > 60 && minutes % 60 === 0
    ? t('settings.liveRecordingHours', { count: minutes / 60 })
    : t('settings.liveRecordingMinutes', { count: minutes });
}
