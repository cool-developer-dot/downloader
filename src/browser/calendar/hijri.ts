/**
 * B24 #269 — the Hijri date for the start page. Intl's Umm al-Qura calendar is used only when it works on this phone
 * (checked once by formatting a known date: 18 February 2026 = 1 Ramadan 1447); otherwise a bundled tabular
 * (arithmetic, civil epoch) calculation, which can differ from Umm al-Qura by a day. A ±2-day adjustment covers local
 * moon sighting (Pakistan often starts a month a day later). Pure; tested under Node.
 */

export type HijriDate = { year: number; month: number; day: number };
export type IntlLike = { DateTimeFormat: typeof Intl.DateTimeFormat };

export const HIJRI_MONTHS_EN = [
  'Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Awwal', 'Jumada al-Thani',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah',
] as const;
export const HIJRI_MONTHS_UR = [
  'محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'جمادی الاول', 'جمادی الثانی',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذوالقعدہ', 'ذوالحجہ',
] as const;
export const GREGORIAN_MONTHS_UR = [
  'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
] as const;
export const GREGORIAN_MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MAX_HIJRI_ADJUST = 2;

export function clampHijriAdjust(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(-MAX_HIJRI_ADJUST, Math.min(MAX_HIJRI_ADJUST, Math.round(n))) : 0;
}

/** Julian day number of a Gregorian date. */
export function gregorianToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

const ISLAMIC_EPOCH = 1948440; // 1 Muharram 1 AH (civil), as a Julian day number

export function hijriToJdn(year: number, month: number, day: number): number {
  return day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + ISLAMIC_EPOCH - 1;
}

/** The bundled tabular calculation (the same as Intl's `islamic-civil`). */
export function tabularHijri(year: number, month: number, day: number): HijriDate {
  const jdn = gregorianToJdn(year, month, day);
  const y = Math.floor((30 * (jdn - ISLAMIC_EPOCH) + 10646) / 10631);
  const m = Math.min(12, Math.ceil((jdn - (29 + hijriToJdn(y, 1, 1))) / 29.5) + 1);
  const d = jdn - hijriToJdn(y, m, 1) + 1;
  return { year: y, month: m, day: d };
}

function intlHijri(intl: IntlLike, year: number, month: number, day: number): HijriDate | null {
  try {
    const format = new intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    const parts = format.formatToParts(new Date(Date.UTC(year, month - 1, day, 12)));
    const num = (type: string) => Number(parts.find((p) => p.type === type)?.value?.replace(/[^0-9]/g, ''));
    const out = { year: num('year'), month: num('month'), day: num('day') };
    return Number.isFinite(out.year) && Number.isFinite(out.month) && Number.isFinite(out.day) ? out : null;
  } catch {
    return null;
  }
}

/** Whether Intl's Umm al-Qura calendar gives the published date for a known day on this phone. */
export function intlHijriWorks(intl: IntlLike | undefined): boolean {
  if (!intl?.DateTimeFormat) return false;
  const known = intlHijri(intl, 2026, 2, 18);
  return known?.year === 1447 && known.month === 9 && known.day === 1;
}

export type HijriSource = 'intl' | 'bundled';

/** A converter fixed once: Intl when it works, the bundled calculation otherwise. */
export function makeHijriConverter(intl: IntlLike | undefined = typeof Intl !== 'undefined' ? Intl : undefined) {
  const source: HijriSource = intlHijriWorks(intl) ? 'intl' : 'bundled';
  return {
    source,
    /** The Hijri date of a Gregorian day, moved by `adjust` days (−2…2). */
    convert(year: number, month: number, day: number, adjust = 0): HijriDate {
      const shifted = new Date(Date.UTC(year, month - 1, day + clampHijriAdjust(adjust), 12));
      const y = shifted.getUTCFullYear();
      const m = shifted.getUTCMonth() + 1;
      const d = shifted.getUTCDate();
      return (source === 'intl' ? intlHijri(intl!, y, m, d) : null) ?? tabularHijri(y, m, d);
    },
  };
}

export type MonthCell = { day: number; hijri: HijriDate } | null;

/** A Gregorian month as weeks of 7 cells (Monday first), each day with its Hijri date. */
export function monthGrid(
  year: number,
  month: number,
  convert: (y: number, m: number, d: number) => HijriDate,
): MonthCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const lead = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, hijri: convert(year, month, d) });
  while (cells.length % 7) cells.push(null);
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
