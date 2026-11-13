import type { TextStyle } from 'react-native';

/**
 * B24 #271 — the caret and alignment of a field follow its text: the first strong letter decides (Urdu, Arabic,
 * Persian, Hebrew → right-to-left; Latin, Greek, Cyrillic → left-to-right); an empty field follows the app's language.
 * So an English address in the Urdu app sits on the left, and Urdu typed in the English app sits on the right. Pure.
 */

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/;
const LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0900-\u0DFF\u0E00-\u0FFF\u3040-\u9FFF\uAC00-\uD7AF]/;

export function firstStrongDirection(text: string | null | undefined): 'rtl' | 'ltr' | null {
  if (!text) return null;
  for (const ch of text) {
    // Eastern digits are weak (they follow the text around them), not right-to-left letters.
    if (DIGITS.test(ch)) continue;
    if (RTL.test(ch)) return 'rtl';
    if (LTR.test(ch)) return 'ltr';
  }
  return null;
}

export function inputDirectionStyle(
  text: string | null | undefined,
  appRtl: boolean,
): Required<Pick<TextStyle, 'textAlign' | 'writingDirection'>> {
  const dir = firstStrongDirection(text) ?? (appRtl ? 'rtl' : 'ltr');
  return dir === 'rtl' ? { textAlign: 'right', writingDirection: 'rtl' } : { textAlign: 'left', writingDirection: 'ltr' };
}

const LTR_KEYBOARDS = new Set(['number-pad', 'numeric', 'decimal-pad', 'phone-pad', 'email-address', 'url', 'visible-password', 'numbers-and-punctuation', 'ascii-capable-number-pad']);
const LTR_INPUT_MODES = new Set(['numeric', 'decimal', 'tel', 'email', 'url']);
const LTR_CONTENT = /^(password|newPassword|new-password|current-password|oneTimeCode|one-time-code|sms-otp|emailAddress|email|username|URL|url|telephoneNumber|tel|creditCardNumber|cc-number|cc-csc|cc-exp|postal-code|postalCode)$/;

/**
 * B24 fix: PIN, password, number, phone, URL and e-mail fields stay left-to-right in Urdu whatever is typed (their
 * text is Latin letters, digits and symbols). Decided from the field's own props.
 */
export function fieldForcesLtr(props: {
  keyboardType?: string | null;
  inputMode?: string | null;
  secureTextEntry?: boolean | null;
  textContentType?: string | null;
  autoComplete?: string | null;
}): boolean {
  if (props.secureTextEntry) return true;
  if (props.keyboardType && LTR_KEYBOARDS.has(props.keyboardType)) return true;
  if (props.inputMode && LTR_INPUT_MODES.has(props.inputMode)) return true;
  return LTR_CONTENT.test(props.textContentType ?? '') || LTR_CONTENT.test(props.autoComplete ?? '');
}

/** 0–9 as Urdu (Extended Arabic-Indic) digits, for the Urdu app's dates and times. */
export function toUrduDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/**
 * An address typed with Eastern digits (۱۹۲.۱۶۸.۱.۱, example.com/۲۰۲۶) as ASCII digits; anything with letters of an
 * Arabic-script word or spaces stays as typed (a search).
 */
export function normalizeAddressDigits(input: string): string {
  if (!/[\u0660-\u0669\u06F0-\u06F9]/.test(input) || /\s/.test(input)) return input;
  if (/[\u0600-\u065F\u066A-\u06EF\u06FA-\u06FF\u0750-\u077F]/.test(input)) return input;
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
