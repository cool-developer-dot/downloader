/**
 * Files F8 (Faran, 2026-11-28: every delete goes to the Recycle bin). The screens can't load under node, so this
 * reads their source: each delete entry point goes through the door (`useDeleteWithUndo`: F2's Confirm before delete,
 * Faran's deleteItems, the Undo bar), and no code outside the bin and the Private move deletes a VidoraX file.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const DOOR = '@/files/trash/useDeleteWithUndo';

/** The delete entry points, by what the user taps. */
const ENTRY_POINTS: Record<string, string> = {
  'Files ⋮ → Delete': 'src/screens/files/FileActionsSheet.tsx',
  'Selection bar → Delete': 'src/screens/files/components/SelectionBar.tsx',
  'Player tab → Delete': 'src/screens/library/hooks/useLibraryScreen.ts',
  'Player → Quick delete': 'src/screens/player/page/use-player-library-stats.ts',
  'Downloads row → Delete': 'src/screens/downloads/hooks/useDownloadsScreen.ts',
  'Download details → Delete': 'src/screens/downloads/hooks/useDownloadDetailsScreen.ts',
  'Download file actions → Delete': 'src/screens/downloads/extras/file-actions/FileActionsScreen.tsx',
  'F5 name clash → Replace': 'src/files/rename/rename-runtime.ts',
  'F9 Clean downloads': 'src/screens/files/CleanDownloadsScreen.tsx',
  'F9 Duplicates': 'src/screens/files/DuplicatesScreen.tsx',
};

const source = (path: string) => readFileSync(path, 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(path.split(String.fromCharCode(92)).join('/'));
  }
  return out;
}

/** The calls that delete a VidoraX file for good (the bin's purge uses them; nothing else may). */
const PERMANENT = /\b(deleteCompletedFileFromVidoraX|deleteLibraryItems|deleteMediaFileOnDevice)\s*\(/;

/** Where a permanent delete is allowed, and why. */
const ALLOWED_PERMANENT: Record<string, string> = {
  'src/files/trash/trash-api.ts': 'the bin itself: emptying it, or a delete with the bin switched off',
  'src/downloads/completed-file/delete/delete-service.ts': 'the delete the bin calls',
  'src/downloads/engine/media-file-actions.ts': 'the engine’s own delete, called by delete-service',
  'src/downloads/v2/engine-port.ts': 'the engine interface: it declares deleteLibraryItems, it doesn’t call it',
  'src/private-vault/move-to-private.runtime.ts': 'a move to Private: the encrypted copy replaces the plain one',
  'src/screens/downloads/components/DownloadCloudSaveAction.tsx':
    'Faran’s cloud “Remove the copy”: written up for him (it should go through the door too)',
};

describe('Files F8: every delete entry point goes through the door into the bin', () => {
  for (const [entry, path] of Object.entries(ENTRY_POINTS)) {
    test(entry, () => {
      const text = source(path);
      assert.ok(text.includes(DOOR), `${path} should use ${DOOR}`);
      assert.doesNotMatch(text, /\bdeleteItems\s*\(/, `${path} should not call deleteItems around the door`);
      assert.doesNotMatch(text, PERMANENT, `${path} should not delete a file itself`);
    });
  }

  test('no other code deletes a VidoraX file for good', () => {
    const offenders = ['src/screens', 'src/files', 'src/player', 'src/downloads/v2', 'src/playlists', 'src/private-vault']
      .flatMap((dir) => walk(dir))
      .filter((path) => PERMANENT.test(source(path)) && !(path in ALLOWED_PERMANENT));
    assert.deepEqual(offenders, []);
  });

  test('nothing deletes a copy outside VidoraX (cloud, or a folder the user saved to)', () => {
    const outside = /\b(deleteExternalCop\w*|removeExternalCop\w*|deleteCloud\w*|removeCloud\w*)\s*\(|externalCopies\w*\.(remove|delete)\(/;
    const offenders = ['src/screens', 'src/files', 'src/player', 'src/downloads', 'src/store']
      .flatMap((dir) => walk(dir))
      .filter((path) => outside.test(source(path)));
    assert.deepEqual(offenders, []);
  });
});
