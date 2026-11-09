/**
 * B11 #108 — the incognito look: one deep-violet palette, the same in the Light and Dark themes (so an incognito tab is
 * never mistaken for a normal one), with text contrast above 7:1 (white on #2B2140; #C9C2DA on #2B2140 ≈ 9:1).
 */
export const INCOGNITO_COLORS = {
  /** The address bar and the incognito section of the tab switcher. */
  surface: '#2B2140',
  /** Fields and chips on that surface. */
  field: '#3B2F55',
  text: '#FFFFFF',
  muted: '#C9C2DA',
  border: '#5A4A7E',
} as const;
