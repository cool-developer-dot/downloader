/**
 * B16 #179 / #180 — the colour matrix a page is drawn through (VidoraWeb `setDisplayFilter`, on the WebView's layer;
 * never a CSS filter). Android's ColorMatrix layout: 4 rows × 5 columns, row-major (R, G, B, A, offset). Pure.
 *
 * - Grayscale: Rec. 709 luminance.
 * - Protanopia / Deuteranopia / Tritanopia: colour **correction** for that colour blindness ("daltonize"): the colours
 *   a person with it can't tell apart are shifted into ones they can, `M = I + E·(I − S)`, with S the simulation
 *   matrix (Machado, Oliveira & Fernandes 2009, severity 1.0) and E the error-shift matrix (red/green errors into green
 *   and blue; blue/yellow errors into red and green).
 * - Night light: blue (and a little green) turned down by the strength — applied after the colour filter.
 */
import type { ColorFilter } from './page-display-settings';

type M3 = readonly [number, number, number, number, number, number, number, number, number];

const IDENTITY3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const SIMULATION: Record<'protanopia' | 'deuteranopia' | 'tritanopia', M3> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const ERROR_SHIFT: Record<'protanopia' | 'deuteranopia' | 'tritanopia', M3> = {
  protanopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  deuteranopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  tritanopia: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
};

const GRAYSCALE: M3 = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];

function mul(a: M3, b: M3): M3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return out as unknown as M3;
}

function add(a: M3, b: M3): M3 {
  return a.map((v, i) => v + b[i]) as unknown as M3;
}

function sub(a: M3, b: M3): M3 {
  return a.map((v, i) => v - b[i]) as unknown as M3;
}

/** The 3×3 colour part of a filter (identity for none). */
export function filterMatrix3(filter: ColorFilter): M3 {
  if (filter === 'grayscale') return GRAYSCALE;
  if (filter === 'none') return IDENTITY3;
  // Daltonize: I + E (I - S).
  return add(IDENTITY3, mul(ERROR_SHIFT[filter], sub(IDENTITY3, SIMULATION[filter])));
}

/** Night light at `strength` 0–100 (percent). */
export function nightLightMatrix3(strength: number): M3 {
  const s = Math.min(100, Math.max(0, strength)) / 100;
  return [1, 0, 0, 0, 1 - 0.18 * s, 0, 0, 0, 1 - 0.6 * s];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000 || 0;
}

/** The 20-number matrix for VidoraWeb `setDisplayFilter`, or null when the page is drawn as it is. */
export function displayMatrix(filter: ColorFilter, nightLight: boolean, strength: number): number[] | null {
  let m: M3 = filterMatrix3(filter);
  if (nightLight && strength > 0) m = mul(nightLightMatrix3(strength), m);
  if (m.every((v, i) => Math.abs(v - IDENTITY3[i]) < 1e-9)) return null;
  return [round(m[0]), round(m[1]), round(m[2]), 0, 0, round(m[3]), round(m[4]), round(m[5]), 0, 0, round(m[6]), round(m[7]), round(m[8]), 0, 0, 0, 0, 0, 1, 0];
}

/** Applies a 20-number matrix to one 0–255 colour (tests, and the settings preview swatch). */
export function applyMatrix(matrix: readonly number[] | null, rgb: readonly [number, number, number]): [number, number, number] {
  if (!matrix) return [rgb[0], rgb[1], rgb[2]];
  const out: number[] = [];
  for (let r = 0; r < 3; r += 1) {
    const v = matrix[r * 5] * rgb[0] + matrix[r * 5 + 1] * rgb[1] + matrix[r * 5 + 2] * rgb[2] + matrix[r * 5 + 4];
    out.push(Math.min(255, Math.max(0, Math.round(v))));
  }
  return out as [number, number, number];
}
