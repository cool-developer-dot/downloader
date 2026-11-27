import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canCreateUnder,
  childFolders,
  descendantIds,
  effectiveParentId,
  folderPathOf,
  indexFolders,
  MAX_FOLDER_DEPTH,
  moveProblem,
  type FolderNode,
} from './folder-tree';

function f(id: string, parentId: string | null = null): FolderNode {
  return { id, name: id.toUpperCase(), parentId, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
}

// A › B › C, A › D, E (root)
const TREE = [f('a'), f('b', 'a'), f('c', 'b'), f('d', 'a'), f('e')];
const IDX = indexFolders(TREE);

describe('folderPathOf', () => {
  test('root folder', () => assert.deepEqual(folderPathOf('a', IDX).map((x) => x.id), ['a']));
  test('three levels', () => assert.deepEqual(folderPathOf('c', IDX).map((x) => x.id), ['a', 'b', 'c']));
  test('unknown folder', () => assert.deepEqual(folderPathOf('zz', IDX), []));
  test('missing parent shows at the root', () => {
    const tree = [f('x', 'gone')];
    assert.deepEqual(folderPathOf('x', indexFolders(tree)).map((n) => n.id), ['x']);
  });
  test('a loop ends at the root instead of hanging', () => {
    const tree = [f('p', 'q'), f('q', 'p')];
    const idx = indexFolders(tree);
    assert.equal(effectiveParentId(tree[0]!, idx), null);
    assert.ok(folderPathOf('p', idx).length <= 2);
  });
  test('self-parent is the root', () => assert.equal(effectiveParentId(f('s', 's'), indexFolders([f('s', 's')])), null));
});

describe('children and descendants', () => {
  test('root children', () => assert.deepEqual(childFolders(null, TREE, IDX).map((x) => x.id), ['a', 'e']));
  test('children of a', () => assert.deepEqual(childFolders('a', TREE, IDX).map((x) => x.id), ['b', 'd']));
  test('descendants of a', () => assert.deepEqual([...descendantIds('a', TREE, IDX)].sort(), ['b', 'c', 'd']));
  test('a leaf has none', () => assert.equal(descendantIds('c', TREE, IDX).size, 0));
});

describe('moveProblem', () => {
  test('into itself → CYCLE', () => assert.equal(moveProblem('a', 'a', TREE, IDX), 'CYCLE'));
  test('into its own child → CYCLE', () => assert.equal(moveProblem('a', 'c', TREE, IDX), 'CYCLE'));
  test('to the root is fine', () => assert.equal(moveProblem('c', null, TREE, IDX), null));
  test('into a sibling is fine', () => assert.equal(moveProblem('d', 'b', TREE, IDX), null));
  test('unknown → NOT_FOUND', () => {
    assert.equal(moveProblem('zz', null, TREE, IDX), 'NOT_FOUND');
    assert.equal(moveProblem('a', 'zz', TREE, IDX), 'NOT_FOUND');
  });
  test('depth limit counts the moved subtree', () => {
    // A chain f1 › f2 › … › f7 (7 levels) and a folder with one child (2 levels).
    const chain = Array.from({ length: 7 }, (_, i) => f(`f${i + 1}`, i === 0 ? null : `f${i}`));
    const tree = [...chain, f('g'), f('h', 'g')];
    const idx = indexFolders(tree);
    assert.equal(moveProblem('h', 'f7', tree, idx), null); // 7 + 1 = 8
    assert.equal(moveProblem('g', 'f7', tree, idx), 'TOO_DEEP'); // 7 + 2 = 9
    assert.equal(MAX_FOLDER_DEPTH, 8);
  });
});

describe('canCreateUnder', () => {
  test('root and normal parents', () => {
    assert.equal(canCreateUnder(null, IDX), null);
    assert.equal(canCreateUnder('c', IDX), null);
    assert.equal(canCreateUnder('zz', IDX), 'NOT_FOUND');
  });
  test('refused at the depth limit', () => {
    const chain = Array.from({ length: 8 }, (_, i) => f(`f${i + 1}`, i === 0 ? null : `f${i}`));
    const idx = indexFolders(chain);
    assert.equal(canCreateUnder('f7', idx), null);
    assert.equal(canCreateUnder('f8', idx), 'TOO_DEEP');
  });
});
