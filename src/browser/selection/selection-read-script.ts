/**
 * B8 — the script VidoraWeb runs in the page when an app item of the text-selection menu is tapped. It only reads what
 * the user selected and returns it as a string: nothing from the app goes into the page.
 *
 * - A selection inside a text field (`<textarea>`, `<input>` of type text / search / url / tel) is read from the field
 *   (`window.getSelection()` is empty there). Password fields and every other input type are never read.
 * - Otherwise the page's selection (`window.getSelection()`, which also covers contenteditable).
 * - At most 20,000 characters; '' when there is nothing (or the page broke something).
 * - B23 #261: for page text the result also carries the selection's anchor — the exact text as the page's text
 *   nodes give it, with up to 32 characters before and after — after a private-use separator (U+E000), as JSON. It
 *   stays inside this one evaluation: nothing is left in the page (B8 fix). `splitSelectionResult` takes it apart
 *   again; every item gets the same text as before (cut a little shorter only for a selection near 20,000
 *   characters, so text and anchor fit the native cap).
 */

/** Between the text and the anchor JSON (Unicode private use; never typed by people). */
export const SELECTION_CONTEXT_SEPARATOR = '\uE000';

export type SelectionAnchor = { exact: string; prefix: string; suffix: string };

/** The read script's result as the text every item uses, and (page text only) the anchor for Highlight. */
export function splitSelectionResult(raw: string): { text: string; anchor: SelectionAnchor | null } {
  const at = typeof raw === 'string' ? raw.lastIndexOf(SELECTION_CONTEXT_SEPARATOR) : -1;
  if (at < 0) return { text: raw, anchor: null };
  const text = raw.slice(0, at);
  try {
    const data = JSON.parse(raw.slice(at + 1)) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const exact = str(data.e, 2000);
    return { text, anchor: exact.trim() ? { exact, prefix: str(data.p, 32), suffix: str(data.s, 32) } : null };
  } catch {
    // A cut or foreign tail: the text alone.
    return { text, anchor: null };
  }
}

/** Matches `SelectionMenu.MAX_TEXT_LENGTH` in Kotlin. */
export const SELECTION_TEXT_MAX = 20_000;

export const SELECTION_READ_SCRIPT = `(function () {
  var MAX = ${SELECTION_TEXT_MAX};
  var text = '';
  var context = '';
  try {
    var el = document.activeElement;
    var tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
    var type = tag === 'INPUT' ? String(el.type || 'text').toLowerCase() : '';
    var readable = tag === 'TEXTAREA' || (tag === 'INPUT' && /^(text|search|url|tel)$/.test(type));
    if (readable) {
      var start = el.selectionStart;
      var end = el.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        text = String(el.value).slice(start, end);
      }
    }
  } catch (e) {
    text = '';
  }
  if (!text) {
    try {
      var selection = window.getSelection ? window.getSelection() : null;
      text = selection ? String(selection) : '';
    } catch (e) {
      text = '';
    }
    try {
      if (text && selection && selection.rangeCount > 0 && document.body) {
        var range = selection.getRangeAt(0);
        var before = document.createRange();
        before.setStart(document.body, 0);
        before.setEnd(range.startContainer, range.startOffset);
        var after = document.createRange();
        after.setStart(range.endContainer, range.endOffset);
        after.setEnd(document.body, document.body.childNodes.length);
        context = JSON.stringify({ e: String(range).slice(0, 2000), p: String(before).slice(-32), s: String(after).slice(0, 32) });
      }
    } catch (e) {}
  }
  if (typeof text !== 'string') return '';
  if (context && context.length < 4000) {
    var room = MAX - context.length - 1;
    return (text.length > room ? text.slice(0, room) : text) + '\\uE000' + context;
  }
  return text.length > MAX ? text.slice(0, MAX) : text;
})();`;
