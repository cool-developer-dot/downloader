/**
 * Phase 1A — local download catalog / create / folders / favorites static checks.
 * Run: npx tsx scripts/verify-phase1a-local-catalog.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log('Phase 1A local catalog verification\n');

test('SQLite version bumped to 2 with catalog tables', () => {
  const db = read('src/storage/constants/database.ts');
  assert(db.includes('DATABASE_VERSION = 2'), 'DATABASE_VERSION must be 2');
  assert(db.includes('downloadsCatalog'), 'downloadsCatalog table name');
  assert(db.includes('mediaFolders'), 'mediaFolders table name');
  assert(db.includes('urlFavorites'), 'urlFavorites table name');
});

test('schema creates catalog indexes', () => {
  const schema = read('src/storage/sqlite/schema.ts');
  assert(schema.includes('applyCatalogSchema'), 'applyCatalogSchema export');
  assert(schema.includes('idx_downloads_catalog_status'), 'status index');
  assert(schema.includes('idx_downloads_catalog_folder_id'), 'folder index');
  assert(schema.includes('idx_downloads_catalog_favorite'), 'favorite index');
});

test('create uses local UUID not POST /downloads', () => {
  const actions = read('src/store/downloads/actions.ts');
  assert(actions.includes('createId()'), 'local createId');
  assert(actions.includes('downloadCatalogRepository'), 'catalog repository');
  assert(
    !/await createDownload\(/.test(actions),
    'must not await createDownload for local create',
  );
  assert(actions.includes('downloadEngine.enqueue'), 'still enqueues engine');
});

test('load/list uses catalog not GET /downloads', () => {
  const actions = read('src/store/downloads/actions.ts');
  assert(
    actions.includes('downloadCatalogRepository.list'),
    'list from catalog',
  );
  assert(!/await listDownloads\(/.test(actions), 'must not await listDownloads');
  assert(
    actions.includes('downloadCatalogRepository.getById'),
    'details from catalog',
  );
});

test('ID preservation seed never regenerates ids', () => {
  const seed = read('src/storage/services/catalog-seed.service.ts');
  assert(seed.includes('insertIfAbsent'), 'insertIfAbsent preserves ids');
  assert(seed.includes('record.downloadId'), 'uses engine downloadId');
  assert(seed.includes('listLocalRecords'), 'seeds from engine records');
  assert(!/randomUUID|createId\(\)/.test(seed), 'seed must not mint new ids');
});

test('folders are local-first', () => {
  const folders = read('src/store/organization/folders.ts');
  assert(folders.includes('mediaFolderRepository'), 'folder repository');
  assert(
    folders.includes('clearFolderAssignments'),
    'delete folder clears assignments without deleting media',
  );
});

test('favorites persist locally', () => {
  const fav = read('src/store/favorites/actions.ts');
  assert(fav.includes('urlFavoriteRepository'), 'url favorites repo');
  assert(fav.includes('downloadCatalogRepository.setFavorite'), 'catalog favorite');
  assert(!fav.includes('patchMediaFavorite'), 'no remote favorite mutation');
});

test('library does not require remote metadata', () => {
  const screen = read('src/screens/library/hooks/useLibraryScreen.ts');
  assert(!screen.includes('fetchAllMediaLibraryPages'), 'no remote fetch');
  assert(!screen.includes('fetchRemoteLibrary'), 'no remote library dep');
  assert(screen.includes('remoteById: {}'), 'empty remote map');
  const bridge = read('src/library/ensure-completion-bridge.ts');
  assert(!bridge.includes('fetchRemoteLibrary'), 'bridge has no remote fetch');
  const repo = read('src/library/repository.ts');
  assert(!repo.includes('fetchRemoteLibrary'), 'repository has no remote fetch');
  assert(!repo.includes('refreshRemoteMetadata'), 'no remote refresh helper');
});

test('bootstrap seeds catalog before engine recover', () => {
  const boot = read('src/bootstrap/app-initializer.ts');
  assert(boot.includes('ensureDownloadCatalogSeeded'), 'seed on boot');
  assert(boot.includes('downloadCatalogRepository.list'), 'hydrate store');
});

console.log('\nAll Phase 1A checks passed.');
