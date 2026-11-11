import { translate } from '@/localization/translate';

/** "12s left", "4m left", "1h 5m left" in the app's language; null when there is no usable estimate. */
export function formatEtaLeft(etaSeconds: number | null): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return null;
  }
  if (etaSeconds < 60) {
    return translate('downloadEta.seconds', { count: Math.ceil(etaSeconds) });
  }
  const minutes = Math.floor(etaSeconds / 60);
  if (minutes < 60) {
    return translate('downloadEta.minutes', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0
    ? translate('downloadEta.hoursMinutes', { hours, minutes: rem })
    : translate('downloadEta.hours', { count: hours });
}
