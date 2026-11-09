import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';

/**
 * B24 #270 — prayer times computed on the phone with adhan (MIT): the Karachi method (Fajr and Isha at 18°) by
 * default, Asr Hanafi (default) or Shafi. A bundled city list or coordinates typed by hand — no location permission,
 * nothing leaves the phone. No sound, no notifications. Pure (apart from adhan); tested under Node against published
 * times.
 */

export type City = { id: string; en: string; ur: string; lat: number; lng: number; tz: string };

export const CITIES: readonly City[] = [
  { id: 'karachi', en: 'Karachi', ur: 'کراچی', lat: 24.8607, lng: 67.0011, tz: 'Asia/Karachi' },
  { id: 'lahore', en: 'Lahore', ur: 'لاہور', lat: 31.5497, lng: 74.3436, tz: 'Asia/Karachi' },
  { id: 'islamabad', en: 'Islamabad', ur: 'اسلام آباد', lat: 33.6844, lng: 73.0479, tz: 'Asia/Karachi' },
  { id: 'rawalpindi', en: 'Rawalpindi', ur: 'راولپنڈی', lat: 33.5651, lng: 73.0169, tz: 'Asia/Karachi' },
  { id: 'faisalabad', en: 'Faisalabad', ur: 'فیصل آباد', lat: 31.4504, lng: 73.135, tz: 'Asia/Karachi' },
  { id: 'multan', en: 'Multan', ur: 'ملتان', lat: 30.1575, lng: 71.5249, tz: 'Asia/Karachi' },
  { id: 'peshawar', en: 'Peshawar', ur: 'پشاور', lat: 34.0151, lng: 71.5249, tz: 'Asia/Karachi' },
  { id: 'quetta', en: 'Quetta', ur: 'کوئٹہ', lat: 30.1798, lng: 66.975, tz: 'Asia/Karachi' },
  { id: 'hyderabad', en: 'Hyderabad (Sindh)', ur: 'حیدرآباد', lat: 25.396, lng: 68.3578, tz: 'Asia/Karachi' },
  { id: 'gujranwala', en: 'Gujranwala', ur: 'گوجرانوالہ', lat: 32.1877, lng: 74.1945, tz: 'Asia/Karachi' },
  { id: 'sialkot', en: 'Sialkot', ur: 'سیالکوٹ', lat: 32.4945, lng: 74.5229, tz: 'Asia/Karachi' },
  { id: 'bahawalpur', en: 'Bahawalpur', ur: 'بہاولپور', lat: 29.3956, lng: 71.6836, tz: 'Asia/Karachi' },
  { id: 'sukkur', en: 'Sukkur', ur: 'سکھر', lat: 27.7052, lng: 68.8574, tz: 'Asia/Karachi' },
  { id: 'muzaffarabad', en: 'Muzaffarabad', ur: 'مظفرآباد', lat: 34.37, lng: 73.4711, tz: 'Asia/Karachi' },
  { id: 'makkah', en: 'Makkah', ur: 'مکہ', lat: 21.4225, lng: 39.8262, tz: 'Asia/Riyadh' },
  { id: 'madinah', en: 'Madinah', ur: 'مدینہ', lat: 24.4686, lng: 39.6142, tz: 'Asia/Riyadh' },
  { id: 'dubai', en: 'Dubai', ur: 'دبئی', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai' },
  { id: 'london', en: 'London', ur: 'لندن', lat: 51.5074, lng: -0.1278, tz: 'Europe/London' },
  { id: 'new-york', en: 'New York', ur: 'نیویارک', lat: 40.7128, lng: -74.006, tz: 'America/New_York' },
  { id: 'toronto', en: 'Toronto', ur: 'ٹورنٹو', lat: 43.6532, lng: -79.3832, tz: 'America/Toronto' },
];

export const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = (typeof PRAYERS)[number];

export type PrayerPlace = { lat: number; lng: number; tz: string | null };

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}

/** "31.55, 74.34" typed by hand → coordinates, or null (out of range / not numbers). */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\u060C\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** The place: hand-typed coordinates (the phone's own time zone) when valid, else the city (Lahore by default). */
export function resolvePlace(cityId: string, coords: string): PrayerPlace {
  const typed = coords.trim() ? parseCoordinates(coords) : null;
  if (typed) return { ...typed, tz: null };
  const city = cityById(cityId) ?? cityById('lahore')!;
  return { lat: city.lat, lng: city.lng, tz: city.tz };
}

export type PrayerDay = Record<PrayerName, Date>;

/** The day's times for a calendar date (year, month 1–12, day) at a place. */
export function prayerTimesFor(place: PrayerPlace, date: { year: number; month: number; day: number }, asr: 'hanafi' | 'shafi'): PrayerDay {
  const params = CalculationMethod.Karachi();
  params.madhab = asr === 'shafi' ? Madhab.Shafi : Madhab.Hanafi;
  // adhan reads the calendar day from the Date's local fields.
  const times = new PrayerTimes(new Coordinates(place.lat, place.lng), new Date(date.year, date.month - 1, date.day, 12), params);
  return { fajr: times.fajr, sunrise: times.sunrise, dhuhr: times.dhuhr, asr: times.asr, maghrib: times.maghrib, isha: times.isha };
}

/** "HH:MM" (24 h) in the place's time zone (the phone's when none, or when Intl can't). */
export function formatPrayerTime(when: Date, tz: string | null): string {
  try {
    if (tz) {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(when);
    }
  } catch {
    // fall through
  }
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/** The calendar date at a place now (its time zone, or the phone's). */
export function placeDate(now: Date, tz: string | null): { year: number; month: number; day: number } {
  try {
    if (tz) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      const out = { year: get('year'), month: get('month'), day: get('day') };
      if (out.year && out.month && out.day) return out;
    }
  } catch {
    // fall through
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The next prayer (sunrise counts as a time, not a prayer) and the time left, from `now`. */
export function nextPrayer(today: PrayerDay, tomorrowFajr: Date, now: Date): { name: Exclude<PrayerName, 'sunrise'>; at: Date; minutesLeft: number } {
  for (const name of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
    if (today[name].getTime() > now.getTime()) {
      return { name, at: today[name], minutesLeft: Math.ceil((today[name].getTime() - now.getTime()) / 60000) };
    }
  }
  return { name: 'fajr', at: tomorrowFajr, minutesLeft: Math.ceil((tomorrowFajr.getTime() - now.getTime()) / 60000) };
}

/** "2:05" for 125 minutes. */
export function formatCountdown(minutes: number): string {
  const m = Math.max(0, minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
