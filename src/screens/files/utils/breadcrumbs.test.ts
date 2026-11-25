import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { folderLookupOf } from '@/files/ui/folder-tree';

import { backTarget, buildBreadcrumbs, upTarget } from './breadcrumbs';

const folder = (id: string, parentId: string | null = null) => ({ id, name: id, parentId });

describe('Files F1 #742 / #743: breadcrumbs, Up to and Back', () => {
  test('the root folder: Files › A, no "Up to" row, Back goes to the Files tab', () => {
    const lookup = folderLookupOf([folder('A')]);
    assert.deepEqual(buildBreadcrumbs('A', lookup, 'Files'), [
      { id: null, label: 'Files', current: false },
      { id: 'A', label: 'A', current: true },
    ]);
    assert.equal(upTarget('A', lookup), null);
    assert.equal(backTarget('A', lookup), null);
    // The Files tab itself is just the first crumb.
    assert.deepEqual(buildBreadcrumbs(null, lookup, 'Files'), [{ id: null, label: 'Files', current: true }]);
  });

  test('three levels deep: Files › A › B › C; "Up to B"; Back walks C → B → A → Files; crumb A is tappable', () => {
    const lookup = folderLookupOf([folder('A'), folder('B', 'A'), folder('C', 'B')]);
    const crumbs = buildBreadcrumbs('C', lookup, 'Files');
    assert.deepEqual(
      crumbs.map((crumb) => crumb.label),
      ['Files', 'A', 'B', 'C'],
    );
    assert.deepEqual(
      crumbs.map((crumb) => crumb.current),
      [false, false, false, true],
    );
    assert.equal(crumbs[1]!.id, 'A');
    assert.equal(upTarget('C', lookup)?.id, 'B');
    assert.equal(backTarget('C', lookup), 'B');
    assert.equal(backTarget('B', lookup), 'A');
    assert.equal(backTarget('A', lookup), null);
  });

  test('a missing parent ends the path at the top level', () => {
    // B was deleted: C now sits right under Files.
    const lookup = folderLookupOf([folder('A'), folder('C', 'B')]);
    assert.deepEqual(
      buildBreadcrumbs('C', lookup, 'Files').map((crumb) => crumb.label),
      ['Files', 'C'],
    );
    assert.equal(upTarget('C', lookup), null);
    assert.equal(backTarget('C', lookup), null);
    // A folder that is gone itself leaves only the Files crumb.
    assert.deepEqual(
      buildBreadcrumbs('B', lookup, 'Files').map((crumb) => crumb.label),
      ['Files'],
    );
  });

  test('a parent loop never hangs and returns the root: Files › X, Back to the Files tab', () => {
    const lookup = folderLookupOf([folder('X', 'Y'), folder('Y', 'Z'), folder('Z', 'X')]);
    const crumbs = buildBreadcrumbs('X', lookup, 'Files');
    assert.deepEqual(crumbs[0], { id: null, label: 'Files', current: false });
    assert.deepEqual(
      crumbs.map((crumb) => crumb.label),
      ['Files', 'X'],
    );
    assert.equal(backTarget('X', lookup), null);
    assert.equal(upTarget('X', lookup), null);
    // A folder that is its own parent too.
    const self = folderLookupOf([folder('S', 'S')]);
    assert.deepEqual(
      buildBreadcrumbs('S', self, 'Files').map((crumb) => crumb.label),
      ['Files', 'S'],
    );
  });
});
