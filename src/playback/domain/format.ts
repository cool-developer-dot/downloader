import { formatPlaybackTime } from '../../player/format-time';
import { intlLocaleForLanguage } from '@/localization/config';
import { getActiveLanguage, translate } from '@/localization/translate';
import { clampProgressPercent, computeProgressPercent } from './progress';

export function formatResumeLabel(positionSeconds: number): string {
  return translate('player.resumeFrom', {
    time: formatPlaybackTime(positionSeconds),
  });
}

export function formatProgressPercentLabel(
  positionSeconds: number,
  durationSeconds: number,
): string {
  const pct = Math.round(
    computeProgressPercent(positionSeconds, durationSeconds),
  );
  return `${clampProgressPercent(pct)}%`;
}

export function formatRemainingLabel(
  positionSeconds: number,
  durationSeconds: number,
): string | null {
  if (
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    positionSeconds < 0
  ) {
    return null;
  }
  const remaining = Math.max(0, durationSeconds - positionSeconds);
  if (remaining < 1) {
    return null;
  }
  if (remaining < 60) {
    return translate('dates.remainingSeconds', { count: Math.round(remaining) });
  }
  const minutes = Math.round(remaining / 60);
  if (minutes < 60) {
    return translate('dates.remainingMinutes', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return translate('dates.remainingHours', { count: hours });
  }
  return translate('dates.remainingHoursMinutes', { hours, minutes: mins });
}

/** Relative last-played label (does not alter stored timestamps). */
export function formatLastPlayedLabel(
  isoDate: string | null | undefined,
  now = new Date(),
): string {
  if (!isoDate) {
    return '';
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) {
    return translate('dates.justNow');
  }
  if (diffMinutes < 60) {
    return translate('dates.minutesAgo', { count: diffMinutes });
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return translate('dates.hoursAgo', { count: diffHours });
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return translate('dates.yesterday');
  }
  if (diffDays < 7) {
    return translate('dates.daysAgo', { count: diffDays });
  }
  return new Intl.DateTimeFormat(intlLocaleForLanguage(getActiveLanguage()), {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export { formatPlaybackTime };
