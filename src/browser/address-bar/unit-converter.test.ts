import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateConversion } from './unit-converter';

const display = (input: string) => evaluateConversion(input)?.display ?? null;

describe('#267 quick converter', () => {
  test('length, weight, volume, speed, data and time', () => {
    assert.equal(display('5 km in mi'), '3.10686 mi');
    assert.equal(display('12 inches to cm'), '30.48 cm');
    assert.equal(display('1 kg to lb'), '2.20462 lb');
    assert.equal(display('1 gallon to l'), '3.78541 l');
    assert.equal(display('1 fl oz to ml'), '29.5735 ml');
    assert.equal(display('100 km/h to mph'), '62.1371 mph');
    assert.equal(display('2 gb = mb'), '2000 MB');
    assert.equal(display('1 gib to mb'), '1073.74 MB');
    assert.equal(display('90 min to h'), '1.5 h');
  });

  test('temperature goes through kelvin', () => {
    assert.equal(display('100 c to f'), '212 °F');
    assert.equal(display('32 fahrenheit in celsius'), '0 °C');
    assert.equal(display('-40 f to c'), '-40 °C');
    assert.equal(display('0 k to c'), '-273.15 °C');
  });

  test('Urdu digits, a decimal comma and no space before the unit', () => {
    assert.equal(display('۵ kg to g'), '5000 g');
    assert.equal(display('2,5km to m'), '2500 m');
  });

  test('not a conversion: different dimensions, unknown units, the same unit, plain text', () => {
    assert.equal(evaluateConversion('5 km to kg'), null);
    assert.equal(evaluateConversion('5 parsecs to km'), null);
    assert.equal(evaluateConversion('5 km to km'), null);
    assert.equal(evaluateConversion('how to cook rice'), null);
    assert.equal(evaluateConversion('12*3'), null);
    assert.equal(evaluateConversion(''), null);
  });
});
