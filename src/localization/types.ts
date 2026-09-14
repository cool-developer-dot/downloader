import type { en } from './en';

type NestedStringRecord = {
  readonly [key: string]: string | NestedStringRecord;
};

export type TranslationCatalog = typeof en;

export type CatalogStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : CatalogStrings<T[K]>;
};

export type TranslationKey = FlattenKeys<TranslationCatalog>;

export type InterpolationParams = Record<string, string | number>;

export type TranslateFn = (
  key: TranslationKey,
  params?: InterpolationParams,
) => string;

export type PluralTranslateFn = (
  key: TranslationKey,
  count: number,
  params?: InterpolationParams,
) => string;

type FlattenKeys<T, Prefix extends string = ''> = {
  [K in keyof T]: T[K] extends string
    ? Prefix extends ''
      ? Extract<K, string>
      : `${Prefix}.${Extract<K, string>}`
    : T[K] extends NestedStringRecord
      ? FlattenKeys<
          T[K],
          Prefix extends '' ? Extract<K, string> : `${Prefix}.${Extract<K, string>}`
        >
      : never;
}[keyof T];

export function flattenCatalog(
  catalog: NestedStringRecord,
  prefix = '',
  acc: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(catalog)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[nextKey] = value;
    } else if (value && typeof value === 'object') {
      flattenCatalog(value, nextKey, acc);
    }
  }
  return acc;
}

export function lookupCatalogValue(
  catalog: NestedStringRecord,
  key: string,
): string | undefined {
  const parts = key.split('.');
  let node: string | NestedStringRecord | undefined = catalog;

  for (const part of parts) {
    if (!node || typeof node === 'string') {
      return undefined;
    }
    node = node[part];
  }

  return typeof node === 'string' ? node : undefined;
}

export function humanizeKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  const spaced = last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) {
    return 'VidoraX';
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
