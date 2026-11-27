import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SWATCH_IDS } from './swatches';
import { clearTagColor, colorsOfTags, normalizeTagColors, renameTagColor, setTagColor, tagColorOf } from './tag-colors';

describe('Files F7 #977: tag colours', () => {
  test('set a colour (tags ignore case), and the 8 swatches', () => {
    assert.equal(SWATCH_IDS.length, 8);
    const colors = setTagColor({}, 'Work', 'red');
    assert.deepEqual(colors, { work: 'red' });
    assert.equal(tagColorOf(colors, 'WORK'), 'red');
    assert.deepEqual(colorsOfTags(setTagColor(colors, 'home', 'blue'), ['work', 'home', 'Work', 'none']), ['red', 'blue']);
  });

  test('clear a colour', () => {
    assert.deepEqual(clearTagColor({ work: 'red', home: 'blue' }, 'Work'), { home: 'blue' });
    assert.equal(tagColorOf(clearTagColor({ work: 'red' }, 'work'), 'work'), null);
  });

  test('an unknown colour is refused, and dropped from what was stored', () => {
    assert.deepEqual(setTagColor({ work: 'red' }, 'work', 'chartreuse'), { work: 'red' });
    assert.deepEqual(normalizeTagColors({ work: 'red', home: 'chartreuse', '': 'blue', trip: 7 }), { work: 'red' });
    assert.deepEqual(normalizeTagColors('red'), {});
  });

  test('a renamed tag keeps its colour', () => {
    assert.deepEqual(renameTagColor({ work: 'red' }, 'work', 'Office'), { office: 'red' });
    assert.deepEqual(renameTagColor({ work: 'red' }, 'nothing', 'x'), { work: 'red' });
  });
});
