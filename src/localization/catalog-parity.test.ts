import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from './en.ts';
import { flattenCatalog } from './types.ts';
import { ur } from './ur.ts';

const enStrings = flattenCatalog(en);
const urStrings = flattenCatalog(ur);

describe('English / Urdu catalog parity', () => {
  it('has exactly the same keys in both catalogs', () => {
    const enKeys = new Set(Object.keys(enStrings));
    const urKeys = new Set(Object.keys(urStrings));
    const missingInUr = [...enKeys].filter((key) => !urKeys.has(key)).sort();
    const extraInUr = [...urKeys].filter((key) => !enKeys.has(key)).sort();

    assert.deepEqual(missingInUr, [], 'keys in en.ts without an Urdu string');
    assert.deepEqual(extraInUr, [], 'keys in ur.ts that en.ts does not have');
  });

  it('has no empty Urdu strings', () => {
    const empty = Object.entries(urStrings)
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key)
      .sort();

    assert.deepEqual(empty, []);
  });

  it('keeps the same {placeholders} in both languages', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const mismatched = Object.keys(enStrings)
      .filter((key) => key in urStrings)
      .filter(
        (key) =>
          placeholders(enStrings[key]).join(',') !== placeholders(urStrings[key]).join(','),
      )
      .sort();

    assert.deepEqual(mismatched, []);
  });
});
