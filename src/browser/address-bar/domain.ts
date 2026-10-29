/**
 * B4 — host helpers for the address bar: the registrable domain (eTLD+1, Public Suffix List via `tldts`, private
 * suffixes such as `github.io` included), and the parts of a displayed address for Domain highlight (#37). Hosts
 * with non-ASCII letters are shown in their punycode (`xn--`) form with a warning, like browsers do for look-alike
 * protection. Pure.
 */

import { getDomain } from 'tldts';

/** `en.wikipedia.org` → `wikipedia.org`, `www.bbc.co.uk` → `bbc.co.uk`; null for IPs, `localhost`, bare suffixes. */
export function registrableDomain(host: string): string | null {
  const clean = host.trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return null;
  return getDomain(clean, { allowPrivateDomains: true }) ?? null;
}

// --- Punycode (RFC 3492), encoding only — enough to show an IDN host in its xn-- form. ---

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digit(d: number): string {
  return String.fromCharCode(d + 22 + 75 * (d < 26 ? 1 : 0));
}

export function punycodeEncode(input: string): string {
  const codePoints = Array.from(input).map((c) => c.codePointAt(0)!);
  let output = codePoints.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < codePoints.length) {
    const m = Math.min(...codePoints.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of codePoints) {
      if (c < n) delta += 1;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          output += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digit(q);
        bias = adapt(delta, handled + 1, handled === basicLength);
        delta = 0;
        handled += 1;
      }
    }
    delta += 1;
    n += 1;
  }
  return output;
}

/** A host with any non-ASCII label in its `xn--` form; ASCII labels unchanged. */
export function toAsciiHost(host: string): string {
  return host
    .split('.')
    .map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : `xn--${punycodeEncode(label.toLowerCase())}`))
    .join('.');
}

export function isPunycodeHost(host: string): boolean {
  return host.split('.').some((label) => label.toLowerCase().startsWith('xn--'));
}

export type DomainHighlightParts = {
  /** Shown dimmed before the domain (`https://`, `en.`). */
  before: string;
  /** The registrable domain, in full colour. */
  domain: string;
  /** Shown dimmed after (path, query). */
  after: string;
  /** An IDN / punycode host: show it with the warning style. */
  idnWarning: boolean;
};

/**
 * Splits a display address (`en.wikipedia.org/wiki/Lahore`, with or without a scheme) for Domain highlight. When no
 * registrable domain can be found (an IP address, `localhost`) the whole host is the highlighted part.
 */
export function splitForDomainHighlight(display: string): DomainHighlightParts | null {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)?([^/?#:]+)(:\d+)?(.*)$/i.exec(display.trim());
  if (!match) return null;
  const scheme = match[1] ?? '';
  const rawHost = match[2]!;
  const port = match[3] ?? '';
  const rest = match[4] ?? '';
  const asciiHost = toAsciiHost(rawHost);
  const idnWarning = isPunycodeHost(asciiHost);
  const domain = registrableDomain(asciiHost);
  if (!domain || !asciiHost.toLowerCase().endsWith(domain)) {
    return { before: scheme, domain: asciiHost, after: `${port}${rest}`, idnWarning };
  }
  const sub = asciiHost.slice(0, asciiHost.length - domain.length);
  return { before: `${scheme}${sub}`, domain: asciiHost.slice(sub.length), after: `${port}${rest}`, idnWarning };
}
