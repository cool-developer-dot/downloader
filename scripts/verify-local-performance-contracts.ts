/**
 * Local performance architecture contracts — static checks only.
 * Does not claim wall-clock benchmarks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-local-performance-contracts.ts
 *   npm run verify:local-performance-contracts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

console.log('Local performance architecture contracts\n');

test('progress ticks do not patch catalog progress/fileSize every interval', () => {
  const bind = read('src/downloads/bind-engine-to-store.ts');
  assert(
    bind.includes('Live bytes/progress live on transferById'),
    'documents transfer-only progress path',
  );
  assert(
    !/updates\.progress = Math\.max\(0, Math\.min\(100, monotonicProgress\)\);\s*updates\.fileSize/.test(
      bind,
    ),
    'must not assign progress+fileSize on every tick',
  );
  assert(
    bind.includes('catalogStatusForExecutionState') &&
      bind.includes('setTransferSnapshot'),
    'still promotes catalog status via execution mapping; live progress on transferById',
  );
});

test('patchItem does not SQLite-write non-durable progress patches', () => {
  const actions = read('src/store/downloads/actions.ts');
  assert(
    actions.includes('never SQLite-write mid-transfer progress ticks'),
    'documents durable-only persist',
  );
  assert(
    !actions.includes('persistDownloadCatalogPatch(id'),
    'no progress-only catalog patch path',
  );
  assert(
    actions.includes('previous.progress === next.progress'),
    'transfer snapshot equality bailout',
  );
});

test('Library assemble is gated on identity signatures, not full transferById', () => {
  const hook = read('src/screens/library/hooks/useLibraryScreen.ts');
  assert(
    hook.includes('selectDownloadCatalogIdentitySignature'),
    'catalog identity signature',
  );
  assert(
    hook.includes('selectLibraryTransferSignature'),
    'library transfer signature',
  );
  assert(
    !/const transfers = useDownloadsStore\(\(state\) => state\.transferById\)/.test(
      hook,
    ),
    'must not subscribe to full transferById',
  );
});

test('catalog seed fast-path uses listAllIds after first seed', () => {
  const seed = read('src/storage/services/catalog-seed.service.ts');
  assert(seed.includes('listAllIds'), 'uses listAllIds');
  assert(seed.includes('recordsById'), 'Map keyed records');
  assert(
    seed.includes('if (already && !options?.force)'),
    'fast path when seeded',
  );
});

test('Home activity signature buckets transfer progress', () => {
  const selectors = read('src/store/downloads/selectors.ts');
  assert(
    selectors.includes('Math.floor(summary.averageProgress / 5)'),
    '5% progress buckets',
  );
  assert(
    selectors.includes('state.transferById[id]?.progress'),
    'reads live transfer progress for average',
  );
});

test('catalog upsert does not re-read after write on success path', () => {
  const repo = read('src/storage/repositories/download-catalog.repository.ts');
  const upsertStart = repo.indexOf('async upsert(');
  const nextMethod = repo.indexOf('async insertIfAbsent(', upsertStart);
  const upsertBody = repo.slice(
    upsertStart,
    nextMethod > upsertStart ? nextMethod : upsertStart + 8000,
  );
  assert(upsertBody.includes('return next;'), 'returns in-memory next');
  assert(
    !upsertBody.includes('const saved = await this.getById(id)'),
    'no trailing getById on upsert success',
  );
});

test('SQLite catalog indexes for real query patterns remain', () => {
  const schema = read('src/storage/sqlite/schema.ts');
  for (const name of [
    'idx_downloads_catalog_status',
    'idx_downloads_catalog_created_at',
    'idx_downloads_catalog_folder_id',
    'idx_downloads_catalog_favorite',
    'idx_downloads_catalog_updated_at',
  ]) {
    assert(schema.includes(name), `missing ${name}`);
  }
});

test('getMediaById does not load full library', () => {
  const repo = read('src/library/repository.ts');
  const fnStart = repo.indexOf('export async function getMediaById');
  const fnBody = repo.slice(fnStart, fnStart + 1200);
  assert(fnBody.includes('deps.getLocalRecord(id)'), 'single-id record load');
  assert(!fnBody.includes('getLibrary()'), 'no full getLibrary');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
