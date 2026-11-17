import type { CatalogStrings } from '../types';
import type { lightFailedEn } from './lightFailed.en';

export const lightFailedUr: CatalogStrings<typeof lightFailedEn> = {
  errorsOne: '1 خرابی',
  errorsOther: '{count} خرابیاں',
  retry: 'دوبارہ کوشش',
  repair: 'مرمت',
  retryOf: 'کوشش {attempts} / {limit}',
  serverLimitDetection: 'سرور کی حد کی شناخت',
  repairPartialFile: 'نامکمل فائل کی مرمت',
  autoResume: 'خودکار بحالی',
  noFailed: 'کوئی ناکام ڈاؤن لوڈ نہیں',
  progressA11y: 'ڈاؤن لوڈ کی پیش رفت',
};
