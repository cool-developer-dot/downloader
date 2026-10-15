import assert from 'node:assert/strict';
import { test } from 'node:test';

import { en } from './en.ts';
import { ur } from './ur.ts';

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else {
      flatten(value, path, out);
    }
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

const enStrings = flatten(en as unknown as Tree);
const urStrings = flatten(ur as unknown as Tree);

test('English and Urdu have exactly the same keys', () => {
  const missingInUr = [...enStrings.keys()].filter((key) => !urStrings.has(key));
  const extraInUr = [...urStrings.keys()].filter((key) => !enStrings.has(key));
  assert.deepEqual(missingInUr, []);
  assert.deepEqual(extraInUr, []);
});

test('no string is empty', () => {
  const empty = [...enStrings, ...urStrings].filter(([, value]) => value.trim().length === 0).map(([key]) => key);
  assert.deepEqual(empty, []);
});

test('Urdu keeps every {placeholder} of the English string', () => {
  const mismatched = [...enStrings]
    .filter(([key, value]) => JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(urStrings.get(key) ?? '')))
    .map(([key]) => key);
  assert.deepEqual(mismatched, []);
});
