import { mmkvKeys } from '@/storage/constants';

import { getMmkvInstance } from './instance';

export function getLanguage(defaultValue = 'en'): string {
  return getMmkvInstance()?.getString(mmkvKeys.language) ?? defaultValue;
}

export function setLanguage(language: string): void {
  getMmkvInstance()?.set(mmkvKeys.language, language);
}

export function clearLanguage(): void {
  getMmkvInstance()?.remove(mmkvKeys.language);
}
