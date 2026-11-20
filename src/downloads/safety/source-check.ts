/**
 * P8 #514 Source check: a badge in the quality sheet — Secure, Check source, or Not secure — built only from what the
 * links themselves show. No list is fetched and nothing is looked up online: the signals are the scheme (HTTPS or
 * not, and a redirect from HTTPS down to HTTP), the redirect count the engine's probe reported, a numeric IP as the
 * host, an international (punycode) or mixed-script look-alike host, a known link shortener, and a free file-locker
 * host from the short bundled lists below. Pure.
 */

export type SourceCheckLevel = 'secure' | 'check' | 'not-secure';

export type SourceCheckSignal =
  | 'https'
  | 'http'
  | 'downgrade'
  | 'ip-host'
  | 'punycode'
  | 'mixed-script'
  | 'shortener'
  | 'file-locker'
  | 'redirects';

export type SourceCheckReason = {
  signal: SourceCheckSignal;
  /** The host the signal is about (as the user would read it), when it is about one. */
  host?: string;
  /** `redirects`: how many hops. */
  count?: number;
};

export type SourceCheckResult = {
  level: SourceCheckLevel;
  /** Every signal found, the most serious first; `https` alone when nothing is wrong. */
  reasons: SourceCheckReason[];
};

export type SourceCheckInput = {
  /** The links in the order the download follows them: page or pasted link, media URL, final URL after redirects. */
  urls: readonly (string | null | undefined)[];
  /** Redirect hops the engine's probe followed (see `probe-observations.ts`); null when not known. */
  redirects?: number | null;
};

/** This many hops or more is a long chain: signed CDN links take one or two. */
export const LONG_REDIRECT_CHAIN = 3;

/** Link shorteners: the link hides where it really goes. */
export const LINK_SHORTENERS: readonly string[] = [
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'v.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'tiny.cc',
  'rb.gy',
  'bit.do',
  's.id',
  't.ly',
  'shorte.st',
  'adf.ly',
  'ouo.io',
  'lnkd.in',
  'tr.im',
  'clck.ru',
];

/** Free file-locker hosts: anyone can upload anything there, and fake "video" files are common. */
export const FILE_LOCKERS: readonly string[] = [
  'mega.nz',
  'mega.io',
  'mediafire.com',
  '1fichier.com',
  'rapidgator.net',
  'uploaded.net',
  'turbobit.net',
  'nitroflare.com',
  'uptobox.com',
  'katfile.com',
  'ddownload.com',
  'filefactory.com',
  'sendspace.com',
  '4shared.com',
  'gofile.io',
  'pixeldrain.com',
  'krakenfiles.com',
  'usersdrive.com',
  'hexupload.net',
  'uploadhaven.com',
  'clicknupload.org',
  'racaty.net',
  'file-upload.com',
  'dropapk.to',
];

const SEVERITY: Record<SourceCheckSignal, number> = {
  downgrade: 0,
  http: 1,
  'mixed-script': 2,
  'ip-host': 3,
  punycode: 4,
  shortener: 5,
  'file-locker': 6,
  redirects: 7,
  https: 8,
};

const NOT_SECURE: ReadonlySet<SourceCheckSignal> = new Set(['http', 'downgrade']);

type ParsedLink = { scheme: string; host: string };

/** Scheme and host of a link, without `URL` (whose IDN handling differs between runtimes). */
export function parseLink(url: string | null | undefined): ParsedLink | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec((url ?? '').trim());
  if (!match) {
    return null;
  }
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase().replace(/\.$/, '');
  if ((scheme !== 'http' && scheme !== 'https') || !host) {
    return null;
  }
  return { scheme, host };
}

export function isIpHost(host: string): boolean {
  if (host.startsWith('[')) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  // Single-number and hex forms browsers also accept as an IPv4 address (`http://3232235777/`, `0x7f.1`).
  return /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host);
}

function matchesDomain(host: string, domains: readonly string[]): boolean {
  const bare = host.replace(/^www\./, '');
  return domains.some((domain) => bare === domain || bare.endsWith(`.${domain}`));
}

type Script = 'latin' | 'cyrillic' | 'greek' | 'armenian' | 'arabic' | 'hebrew' | 'cjk' | 'other';

function scriptOf(char: string): Script | null {
  const code = char.codePointAt(0)!;
  if (/[0-9\-_.]/.test(char)) return null;
  if (code < 0x80 || (code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff)) return 'latin';
  if (code >= 0x400 && code <= 0x52f) return 'cyrillic';
  if (code >= 0x370 && code <= 0x3ff) return 'greek';
  if (code >= 0x530 && code <= 0x58f) return 'armenian';
  if ((code >= 0x600 && code <= 0x6ff) || (code >= 0x750 && code <= 0x77f) || (code >= 0xfb50 && code <= 0xfdff)) return 'arabic';
  if (code >= 0x590 && code <= 0x5ff) return 'hebrew';
  if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)) return 'cjk';
  return 'other';
}

/** A host label written in more than one script (`pаypal` with a Cyrillic `а`): a look-alike. */
export function isMixedScript(label: string): boolean {
  const scripts = new Set<Script>();
  for (const char of Array.from(label)) {
    const script = scriptOf(char);
    if (script) scripts.add(script);
  }
  return scripts.size > 1;
}

/** RFC 3492 Punycode decoding of one label's part after `xn--`; null when it is not valid Punycode. */
export function decodePunycode(input: string): string | null {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const output: number[] = [];
  const delimiter = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(delimiter, 0); j += 1) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = 128;
  let i = 0;
  let bias = 72;
  const adapt = (deltaIn: number, numPoints: number, first: boolean): number => {
    let delta = first ? Math.floor(deltaIn / damp) : deltaIn >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) return null;
      const code = input.charCodeAt(index++);
      const digit =
        code >= 48 && code <= 57 ? code - 22 : code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 97 : base;
      if (digit >= base) return null;
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
      if (w > 0x7fffffff || i > 0x7fffffff) return null;
    }
    bias = adapt(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i += 1;
  }
  try {
    return String.fromCodePoint(...output);
  } catch {
    return null;
  }
}

/** The host as a person reads it: Punycode labels decoded. */
export function displayHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.startsWith('xn--') ? (decodePunycode(label.slice(4)) ?? label) : label))
    .join('.');
}

function hostSignals(host: string): SourceCheckReason[] {
  const reasons: SourceCheckReason[] = [];
  const shown = displayHost(host);
  if (isIpHost(host)) {
    reasons.push({ signal: 'ip-host', host });
    return reasons;
  }
  const labels = shown.split('.');
  if (labels.some(isMixedScript)) {
    reasons.push({ signal: 'mixed-script', host: shown });
  } else if (host.split('.').some((label) => label.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)) {
    reasons.push({ signal: 'punycode', host: shown });
  }
  if (matchesDomain(host, LINK_SHORTENERS)) {
    reasons.push({ signal: 'shortener', host: shown });
  }
  if (matchesDomain(host, FILE_LOCKERS)) {
    reasons.push({ signal: 'file-locker', host: shown });
  }
  return reasons;
}

/** Pure: the badge for these links. */
export function assessSource(input: SourceCheckInput): SourceCheckResult {
  const links = input.urls.map(parseLink).filter((link): link is ParsedLink => link != null);
  if (links.length === 0) {
    return { level: 'check', reasons: [] };
  }
  const reasons: SourceCheckReason[] = [];
  const seen = new Set<string>();
  const add = (reason: SourceCheckReason) => {
    const key = `${reason.signal}|${reason.host ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      reasons.push(reason);
    }
  };
  let sawHttps = false;
  for (const link of links) {
    if (link.scheme === 'https') {
      sawHttps = true;
    } else if (sawHttps) {
      add({ signal: 'downgrade', host: displayHost(link.host) });
    } else {
      add({ signal: 'http', host: displayHost(link.host) });
    }
    hostSignals(link.host).forEach(add);
  }
  const redirects = input.redirects ?? 0;
  if (redirects >= LONG_REDIRECT_CHAIN) {
    add({ signal: 'redirects', count: redirects });
  }
  if (reasons.length === 0) {
    return { level: 'secure', reasons: [{ signal: 'https' }] };
  }
  reasons.sort((a, b) => SEVERITY[a.signal] - SEVERITY[b.signal]);
  const level: SourceCheckLevel = reasons.some((reason) => NOT_SECURE.has(reason.signal)) ? 'not-secure' : 'check';
  return { level, reasons };
}
