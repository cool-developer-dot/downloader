/**
 * Download Settings → Advanced network: Custom User-Agent (#443), Custom Headers (#444) and the timeout (#349). Pure.
 *
 * Every default is today's behaviour, and today's behaviour sends nothing new to the native side: the browser's own
 * User-Agent, no extra headers, 20 s to connect and 30 s without data. Nothing here can weaken a download: TLS is
 * never touched, URLs are never touched (the public-address and redirect checks still decide every request), and a
 * header that would change what the request is — Cookie, Authorization, Host, Range, … — is refused.
 */

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

export type HeaderPair = { name: string; value: string };

export type UserAgentMode = 'automatic' | 'custom';
export type TimeoutChoice = 'automatic' | '15' | '30' | '60' | '120';

export type NetworkOptionsInput = {
  userAgentMode: UserAgentMode;
  /** Kept while "Automatic" is chosen, so switching back restores it. */
  customUserAgent: string;
  headers: HeaderPair[];
  timeout: TimeoutChoice;
};

export const DEFAULT_NETWORK_OPTIONS: NetworkOptionsInput = {
  userAgentMode: 'automatic',
  customUserAgent: '',
  headers: [],
  timeout: 'automatic',
};

export const MAX_USER_AGENT_LENGTH = 256;
export const MAX_HEADERS = 10;
export const MAX_HEADER_NAME_LENGTH = 64;
export const MAX_HEADER_VALUE_LENGTH = 512;

/** Today's timeouts (net/HttpClient.kt): what "Automatic" keeps. */
export const TODAY_CONNECT_TIMEOUT_SECONDS = 20;
export const TODAY_READ_TIMEOUT_SECONDS = 30;
/** The safe range a custom timeout is clamped to. */
export const MIN_TIMEOUT_SECONDS = 10;
export const MAX_TIMEOUT_SECONDS = 120;
export const TIMEOUT_CHOICES: readonly TimeoutChoice[] = ['automatic', '15', '30', '60', '120'];

/** Names that would change what the request is, who it is from, or how its bytes are counted. */
export const REFUSED_HEADER_NAMES: readonly string[] = [
  'cookie',
  'cookie2',
  'authorization',
  'host',
  'content-length',
  'range',
  'if-range',
  'connection',
  'transfer-encoding',
  'te',
  'upgrade',
  'trailer',
  'keep-alive',
  'expect',
  // Downloads ask for the bytes as they are; a compressed answer would break resume and size checks.
  'accept-encoding',
  // Has its own option.
  'user-agent',
];
export const REFUSED_HEADER_PREFIXES: readonly string[] = ['proxy-', 'sec-', 'x-vidorax-'];

/** An HTTP token (RFC 9110 §5.6.2): what a header name may be made of. */
const TOKEN = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
const LINE_BREAK = /[\r\n\u0000\u2028\u2029]/;
/** Visible ASCII, spaces and tabs: what HTTP/1.1 header values (and the native client) accept. */
const VISIBLE_ASCII = /^[\t\u0020-\u007e]*$/;

export type UserAgentCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'line-break' | 'not-ascii' };

/** A custom User-Agent as it would be sent: trimmed, one line, visible ASCII, capped. */
export function validateUserAgent(raw: string): UserAgentCheck {
  if (LINE_BREAK.test(raw)) {
    return { ok: false, reason: 'line-break' };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, reason: 'empty' };
  }
  if (value.length > MAX_USER_AGENT_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  if (!VISIBLE_ASCII.test(value)) {
    return { ok: false, reason: 'not-ascii' };
  }
  return { ok: true, value };
}

export type HeaderProblem =
  | 'empty-name'
  | 'invalid-name'
  | 'refused-name'
  | 'name-too-long'
  | 'empty-value'
  | 'value-too-long'
  | 'line-break'
  | 'not-ascii'
  | 'duplicate'
  | 'too-many';

export function isRefusedHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return REFUSED_HEADER_NAMES.includes(lower) || REFUSED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function headerNameProblem(raw: string): HeaderProblem | null {
  if (LINE_BREAK.test(raw)) {
    return 'line-break';
  }
  const name = raw.trim();
  if (!name) {
    return 'empty-name';
  }
  if (name.length > MAX_HEADER_NAME_LENGTH) {
    return 'name-too-long';
  }
  if (!TOKEN.test(name)) {
    return 'invalid-name';
  }
  return isRefusedHeaderName(name) ? 'refused-name' : null;
}

export function headerValueProblem(raw: string): HeaderProblem | null {
  if (LINE_BREAK.test(raw)) {
    return 'line-break';
  }
  const value = raw.trim();
  if (!value) {
    return 'empty-value';
  }
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    return 'value-too-long';
  }
  return VISIBLE_ASCII.test(value) ? null : 'not-ascii';
}

/** Whether `pair` may be added to `existing`; null when it may. */
export function addHeaderProblem(existing: readonly HeaderPair[], pair: HeaderPair): HeaderProblem | null {
  const problem = headerNameProblem(pair.name) ?? headerValueProblem(pair.value);
  if (problem) {
    return problem;
  }
  const lower = pair.name.trim().toLowerCase();
  if (existing.some((header) => header.name.toLowerCase() === lower)) {
    return 'duplicate';
  }
  return existing.length >= MAX_HEADERS ? 'too-many' : null;
}

/** Whatever was stored, as headers: only valid, unique pairs, at most MAX_HEADERS. */
export function normalizeHeaders(raw: unknown): HeaderPair[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: HeaderPair[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { name, value } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof value !== 'string') {
      continue;
    }
    const pair = { name: name.trim(), value: value.trim() };
    if (addHeaderProblem(out, pair) === null) {
      out.push(pair);
    }
  }
  return out;
}

function isTimeoutChoice(value: unknown): value is TimeoutChoice {
  return typeof value === 'string' && (TIMEOUT_CHOICES as readonly string[]).includes(value);
}

/** A timeout in seconds, clamped to the safe range; null (today's timeouts) for anything that is not a number. */
export function clampTimeoutSeconds(value: unknown): number | null {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null;
  }
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));
}

/** Whatever was stored, as options; anything unknown is today's behaviour. Headers are kept elsewhere. */
export function normalizeNetworkOptions(raw: unknown): Omit<NetworkOptionsInput, 'headers'> {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const customUserAgent =
    typeof value.customUserAgent === 'string' && validateUserAgent(value.customUserAgent).ok
      ? value.customUserAgent.trim()
      : '';
  return {
    userAgentMode: value.userAgentMode === 'custom' && customUserAgent ? 'custom' : 'automatic',
    customUserAgent,
    timeout: isTimeoutChoice(value.timeout) ? value.timeout : 'automatic',
  };
}

export function isDefaultNetworkOptions(options: NetworkOptionsInput | null | undefined): boolean {
  return Object.keys(networkSettingsFields(options)).length === 0;
}

export type NetworkSettingsFields = Pick<
  DownloadSettings,
  'userAgent' | 'customHeaders' | 'connectTimeoutSeconds' | 'readTimeoutSeconds'
>;

/**
 * Pure: the download-settings fields these options add — only what differs from today's behaviour. Untouched
 * options (or none) add nothing, so the native side receives exactly what it received before.
 */
export function networkSettingsFields(options: NetworkOptionsInput | null | undefined): NetworkSettingsFields {
  if (!options) {
    return {};
  }
  const fields: NetworkSettingsFields = {};
  if (options.userAgentMode === 'custom') {
    const agent = validateUserAgent(options.customUserAgent);
    if (agent.ok) {
      fields.userAgent = agent.value;
    }
  }
  const headers = normalizeHeaders(options.headers);
  if (headers.length > 0) {
    fields.customHeaders = Object.fromEntries(headers.map((header) => [header.name, header.value]));
  }
  if (options.timeout !== 'automatic') {
    const seconds = clampTimeoutSeconds(options.timeout);
    if (seconds !== null) {
      fields.connectTimeoutSeconds = seconds;
      fields.readTimeoutSeconds = seconds;
    }
  }
  return fields;
}

function sameHeaders(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const left = Object.entries(a ?? {});
  const right = b ?? {};
  return left.length === Object.keys(right).length && left.every(([name, value]) => right[name] === value);
}

/** Whether two pushed settings carry the same network fields. */
export function sameNetworkFields(a: NetworkSettingsFields, b: NetworkSettingsFields): boolean {
  return (
    a.userAgent === b.userAgent &&
    a.connectTimeoutSeconds === b.connectTimeoutSeconds &&
    a.readTimeoutSeconds === b.readTimeoutSeconds &&
    sameHeaders(a.customHeaders, b.customHeaders)
  );
}
