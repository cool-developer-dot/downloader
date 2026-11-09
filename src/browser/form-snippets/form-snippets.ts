/**
 * B22 #274 — Quick form fill (pure). The user keeps short text snippets in Browser settings → Form snippets; a bar
 * above the keyboard offers them while a suitable page field has focus, and a tap inserts one. Never filled
 * automatically.
 *
 * The page script reports only the kind of the focused field ('text', 'email', 'tel', 'url', 'search', 'textarea' or
 * null) — no value, name, label or address — and never reports password, one-time-code or card fields (by type,
 * `autocomplete`, or a name / id / autocomplete that says card, CVC, expiry, OTP, password or PIN).
 */

export const MAX_SNIPPETS = 20;
export const MAX_SNIPPET_LENGTH = 500;
export const DEFAULT_FORM_SNIPPETS_JSON = '[]';
export const FORM_FIELD_MESSAGE = 'vidorax_form_field';
export const FIELD_KINDS = ['text', 'email', 'tel', 'url', 'search', 'textarea'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export function parseSnippets(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, MAX_SNIPPET_LENGTH).trim();
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

export function serializeSnippets(list: readonly string[]): string {
  return JSON.stringify(parseSnippets([...list]));
}

/** The field kind from a page message; undefined for any other message, null kind for anything unexpected. */
export function parseFieldMessage(raw: string): { kind: FieldKind | null } | undefined {
  if (typeof raw !== 'string' || !raw.includes(FORM_FIELD_MESSAGE)) return undefined;
  try {
    const data = JSON.parse(raw) as { type?: unknown; kind?: unknown };
    if (data?.type !== FORM_FIELD_MESSAGE) return undefined;
    return (FIELD_KINDS as readonly unknown[]).includes(data.kind) ? { kind: data.kind as FieldKind } : { kind: null };
  } catch {
    return undefined;
  }
}

/** Document-start script: reports the focused field's kind (only) through the page's ReactNativeWebView channel. */
export const FORM_FIELD_SCRIPT = `(function () {
  try {
    if (window.__vidoraxFormField) return;
    window.__vidoraxFormField = true;
    var SENSITIVE = /(^|[^a-z])(cc|card|cardnumber|cvc|cvv|csc|exp|expiry|expiration|iban|otp|onetime|one-time|password|passcode|pin)([^a-z]|$)/i;
    var kindOf = function (el) {
      if (!el || el.disabled || el.readOnly) return null;
      var tag = String(el.tagName || '').toLowerCase();
      var auto = String((el.getAttribute && el.getAttribute('autocomplete')) || '').toLowerCase();
      if (/one-time-code|cc-|current-password|new-password/.test(auto)) return null;
      if (SENSITIVE.test([el.name, el.id, auto].join(' '))) return null;
      if (tag === 'textarea') return 'textarea';
      if (tag !== 'input') return null;
      var type = String(el.type || 'text').toLowerCase();
      return ['text', 'email', 'tel', 'url', 'search'].indexOf(type) >= 0 ? type : null;
    };
    var last = null;
    var send = function (kind) {
      if (kind === last) return;
      last = kind;
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${FORM_FIELD_MESSAGE}', kind: kind }));
      } catch (e) {}
    };
    document.addEventListener('focusin', function (event) { send(kindOf(event.target)); }, true);
    document.addEventListener('focusout', function () {
      setTimeout(function () { send(kindOf(document.activeElement)); }, 0);
    }, true);
  } catch (e) {}
})();`;

/**
 * Inserts `text` at the caret of the focused field (only a field this script would report), firing the input event
 * pages listen for. The text is the user's own snippet, which they chose to put in this field.
 */
export function insertSnippetScript(text: string): string {
  return `(function () {
  try {
    var el = document.activeElement;
    if (!el || el.disabled || el.readOnly) return;
    var tag = String(el.tagName || '').toLowerCase();
    var type = String(el.type || 'text').toLowerCase();
    if (!(tag === 'textarea' || (tag === 'input' && ['text', 'email', 'tel', 'url', 'search'].indexOf(type) >= 0))) return;
    var value = ${JSON.stringify(text.slice(0, MAX_SNIPPET_LENGTH))};
    var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
    var proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, el.value.slice(0, start) + value + el.value.slice(end));
    try { el.setSelectionRange(start + value.length, start + value.length); } catch (e) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) {}
})();
true;`;
}
