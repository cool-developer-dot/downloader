import { getMmkvInstance } from './instance';
import { mmkvKeys, type MmkvKey } from '@/storage/constants';

export function mmkvGetString(key: string): string | undefined {
  return getMmkvInstance()?.getString(key);
}

export function mmkvSetString(key: string, value: string): void {
  getMmkvInstance()?.set(key, value);
}

export function mmkvGetBoolean(key: string): boolean | undefined {
  return getMmkvInstance()?.getBoolean(key);
}

export function mmkvSetBoolean(key: string, value: boolean): void {
  getMmkvInstance()?.set(key, value);
}

export function mmkvGetNumber(key: string): number | undefined {
  return getMmkvInstance()?.getNumber(key);
}

export function mmkvSetNumber(key: string, value: number): void {
  getMmkvInstance()?.set(key, value);
}

export function mmkvContains(key: string): boolean {
  return getMmkvInstance()?.contains(key) ?? false;
}

export function mmkvRemove(key: string): boolean {
  return getMmkvInstance()?.remove(key) ?? false;
}

export function mmkvGetAllKeys(): string[] {
  return getMmkvInstance()?.getAllKeys() ?? [];
}

export function mmkvClearAll(): void {
  getMmkvInstance()?.clearAll();
}

export function mmkvGetObject<T>(key: string): T | null {
  const raw = mmkvGetString(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function mmkvSetObject<T>(key: string, value: T): void {
  mmkvSetString(key, JSON.stringify(value));
}

export function isKnownMmkvKey(key: string): key is MmkvKey {
  return (Object.values(mmkvKeys) as string[]).includes(key);
}
