/**
 * #267 Quick Converter, next to the B4 #268 calculator: `5 km in mi`, `100 f to c`, `2 gb = mb`, `۵ kg to lb` typed in
 * the address bar shows the converted value as the first suggestion. Units only (length, weight, volume, temperature,
 * speed, data size, time): no currency, because rates would need a server and VidoraX keeps everything on the phone.
 * Pure.
 */

import { toAsciiDigits } from '@/utils/search-text';

import { formatCalculatorValue, type CalculatorResult } from './calculator';

type Dimension = 'length' | 'mass' | 'volume' | 'temperature' | 'speed' | 'data' | 'time';

type Unit = {
  dimension: Dimension;
  /** The symbol shown in the result. */
  symbol: string;
  /** Linear units: how many base units one of this is (metre, gram, litre, m/s, byte, second). */
  factor?: number;
  /** Temperature: to and from kelvin. */
  toKelvin?: (value: number) => number;
  fromKelvin?: (kelvin: number) => number;
};

const linear = (dimension: Dimension, symbol: string, factor: number): Unit => ({ dimension, symbol, factor });

const UNITS: Record<string, Unit> = {};

function define(unit: Unit, ...names: string[]): void {
  for (const name of names) UNITS[name] = unit;
}

// Length (metre).
define(linear('length', 'mm', 0.001), 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres');
define(linear('length', 'cm', 0.01), 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres');
define(linear('length', 'm', 1), 'm', 'meter', 'meters', 'metre', 'metres');
define(linear('length', 'km', 1000), 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
define(linear('length', 'in', 0.0254), 'inch', 'inches', '"');
define(linear('length', 'ft', 0.3048), 'ft', 'foot', 'feet', "'");
define(linear('length', 'yd', 0.9144), 'yd', 'yard', 'yards');
define(linear('length', 'mi', 1609.344), 'mi', 'mile', 'miles');
// Mass (gram).
define(linear('mass', 'mg', 0.001), 'mg', 'milligram', 'milligrams');
define(linear('mass', 'g', 1), 'g', 'gram', 'grams', 'gm');
define(linear('mass', 'kg', 1000), 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos');
define(linear('mass', 't', 1_000_000), 'tonne', 'tonnes', 'ton', 'tons');
define(linear('mass', 'oz', 28.349523125), 'oz', 'ounce', 'ounces');
define(linear('mass', 'lb', 453.59237), 'lb', 'lbs', 'pound', 'pounds');
// Volume (litre; US measures).
define(linear('volume', 'ml', 0.001), 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres');
define(linear('volume', 'l', 1), 'l', 'liter', 'liters', 'litre', 'litres');
define(linear('volume', 'gal', 3.785411784), 'gal', 'gallon', 'gallons');
define(linear('volume', 'cup', 0.2365882365), 'cup', 'cups');
define(linear('volume', 'fl oz', 0.0295735295625), 'floz', 'fl oz');
// Speed (metre per second).
define(linear('speed', 'm/s', 1), 'm/s', 'mps');
define(linear('speed', 'km/h', 1000 / 3600), 'km/h', 'kmh', 'kph', 'kmph');
define(linear('speed', 'mph', 1609.344 / 3600), 'mph');
define(linear('speed', 'kn', 1852 / 3600), 'kn', 'knot', 'knots');
// Data size (byte; KB = 1000 bytes, KiB = 1024, as Android shows sizes).
define(linear('data', 'B', 1), 'b', 'byte', 'bytes');
define(linear('data', 'KB', 1e3), 'kb', 'kilobyte', 'kilobytes');
define(linear('data', 'MB', 1e6), 'mb', 'megabyte', 'megabytes');
define(linear('data', 'GB', 1e9), 'gb', 'gigabyte', 'gigabytes');
define(linear('data', 'TB', 1e12), 'tb', 'terabyte', 'terabytes');
define(linear('data', 'KiB', 1024), 'kib');
define(linear('data', 'MiB', 1024 ** 2), 'mib');
define(linear('data', 'GiB', 1024 ** 3), 'gib');
// Time (second).
define(linear('time', 's', 1), 's', 'sec', 'secs', 'second', 'seconds');
define(linear('time', 'min', 60), 'min', 'mins', 'minute', 'minutes');
define(linear('time', 'h', 3600), 'h', 'hr', 'hrs', 'hour', 'hours');
define(linear('time', 'day', 86_400), 'day', 'days');
define(linear('time', 'week', 604_800), 'week', 'weeks', 'wk');
// Temperature (kelvin).
define({ dimension: 'temperature', symbol: '°C', toKelvin: (v) => v + 273.15, fromKelvin: (k) => k - 273.15 }, 'c', '°c', 'celsius');
define(
  { dimension: 'temperature', symbol: '°F', toKelvin: (v) => ((v - 32) * 5) / 9 + 273.15, fromKelvin: (k) => ((k - 273.15) * 9) / 5 + 32 },
  'f',
  '°f',
  'fahrenheit',
);
define({ dimension: 'temperature', symbol: 'K', toKelvin: (v) => v, fromKelvin: (k) => k }, 'k', 'kelvin');

const MAX_INPUT = 60;
/** `<number> <unit> to|in|into|=|→|میں <unit>`; the number may be negative or decimal (`.` or `,`). */
const PATTERN = /^(-?\d+(?:[.,]\d+)?)\s*([a-z°"'/ ]+?)\s+(?:to|in|into|=|→|->|میں)\s+([a-z°"'/ ]+)$/i;

function unitOf(text: string): Unit | null {
  const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return UNITS[key] ?? UNITS[key.replace(/ /g, '')] ?? null;
}

/** The converted value when `input` is a unit conversion, else null. */
export function evaluateConversion(input: string): CalculatorResult | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT) return null;
  const match = PATTERN.exec(toAsciiDigits(trimmed).replace(/\s+/g, ' '));
  if (!match) return null;
  const amount = Number(match[1]!.replace(',', '.'));
  const from = unitOf(match[2]!);
  const to = unitOf(match[3]!);
  if (!Number.isFinite(amount) || !from || !to || from.dimension !== to.dimension || from === to) return null;
  let value: number;
  if (from.dimension === 'temperature') {
    value = to.fromKelvin!(from.toKelvin!(amount));
  } else {
    value = (amount * from.factor!) / to.factor!;
  }
  if (!Number.isFinite(value)) return null;
  // Six significant digits read like a converter (3.10686 mi), not like a calculator's twelve.
  const rounded = Math.abs(value) >= 1e15 || value === 0 ? value : Number(value.toPrecision(6));
  return { expression: trimmed, value, display: `${formatCalculatorValue(rounded)} ${to.symbol}` };
}
