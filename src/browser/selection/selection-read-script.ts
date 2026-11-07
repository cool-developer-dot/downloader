/**
 * B8 — the script VidoraWeb runs in the page when an app item of the text-selection menu is tapped. It only reads what
 * the user selected and returns it as a string: nothing from the app goes into the page.
 *
 * - A selection inside a text field (`<textarea>`, `<input>` of type text / search / url / tel) is read from the field
 *   (`window.getSelection()` is empty there). Password fields and every other input type are never read.
 * - Otherwise the page's selection (`window.getSelection()`, which also covers contenteditable).
 * - At most 20,000 characters; '' when there is nothing (or the page broke something).
 */

/** Matches `SelectionMenu.MAX_TEXT_LENGTH` in Kotlin. */
export const SELECTION_TEXT_MAX = 20_000;

export const SELECTION_READ_SCRIPT = `(function () {
  var MAX = ${SELECTION_TEXT_MAX};
  var text = '';
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
  }
  if (typeof text !== 'string') return '';
  return text.length > MAX ? text.slice(0, MAX) : text;
})();`;
