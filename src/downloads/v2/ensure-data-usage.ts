import { useSettingsStore } from '@/store/settings';

import { normalizeLimitMb } from './data-usage';
import { ensureDataUsage, setDataLimitSource } from './data-usage-store';

/** Starts data-usage counting and reads the optional limits from settings (off by default). Idempotent. */
export function ensureDataUsageCounting(): void {
  setDataLimitSource(() => {
    const settings = useSettingsStore.getState();
    return {
      dailyMb: normalizeLimitMb(settings.dataLimitDailyMb),
      monthlyMb: normalizeLimitMb(settings.dataLimitMonthlyMb),
    };
  });
  ensureDataUsage();
}
