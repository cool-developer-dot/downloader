import * as Crypto from 'expo-crypto';

export async function createId(): Promise<string> {
  return Crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
