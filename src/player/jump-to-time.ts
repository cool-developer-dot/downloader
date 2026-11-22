/**
 * P1 #532 Jump to Time: the time the user types, as seconds. Accepts `ss`, `m:ss` and `h:mm:ss`, Western digits and
 * the Urdu (۰–۹) and Arabic (٠–٩) ones, and the Urdu keyboard's ":" look-alikes. Minutes and seconds after the first
 * part must be below 60, as on a clock.
 */

export type JumpTimeResult =
  | { ok: true; seconds: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'beyond' };

const URDU_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

function toWesternDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= URDU_ZERO && code <= URDU_ZERO + 9) {
      out += String(code - URDU_ZERO);
    } else if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) {
      out += String(code - ARABIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/** ":" and the colon-like marks an Urdu or Arabic keyboard can type: fullwidth, modifier-letter and triangular colons. */
const SEPARATORS = new RegExp(`[:${String.fromCharCode(0xff1a, 0xa789, 0x02d0)}]`, 'g');

export function parseJumpTime(input: string, durationSeconds?: number | null): JumpTimeResult {
  const text = toWesternDigits(input).replace(SEPARATORS, ':').replace(/\s+/g, '');
  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d{1,6}$/.test(part))) {
    return { ok: false, reason: 'invalid' };
  }
  const numbers = parts.map((part) => Number(part));
  // Every part after the first is a clock field (minutes or seconds).
  if (numbers.slice(1).some((value) => value >= 60) || parts.slice(1).some((part) => part.length > 2)) {
    return { ok: false, reason: 'invalid' };
  }
  const seconds = numbers.reduce((total, value) => total * 60 + value, 0);
  if (
    durationSeconds != null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    seconds > durationSeconds
  ) {
    return { ok: false, reason: 'beyond' };
  }
  return { ok: true, seconds };
}

/** The field's starting text: the current time as `m:ss` or `h:mm:ss`, whole seconds. */
export function formatJumpTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
