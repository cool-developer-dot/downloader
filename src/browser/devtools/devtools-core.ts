/**
 * B19 Developer tools — the pure rules (tested under Node): user agents and device sizes, user-script match patterns
 * and `.user.js` headers, and the one gate that decides what is injected into a page. Tools off (the default) means
 * `devtoolsDocumentStartScript` and `userScriptsAtEnd` return nothing at all.
 */

// ---- user agent (#226) and device emulation (#227) ----

export const DEVTOOLS_UA_MODES = ['default', 'desktop', 'iphone', 'ipad', 'custom'] as const;
export type DevtoolsUaMode = (typeof DEVTOOLS_UA_MODES)[number];

export const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const UA_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const UA_ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
export const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type DevicePreset = { id: string; width: number; height: number; ua: string };

/** #227: page widths with the matching user agent (phones, tablet, laptop, desktop). */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: '360', width: 360, height: 800, ua: UA_ANDROID_PHONE },
  { id: '412', width: 412, height: 915, ua: UA_ANDROID_PHONE },
  { id: '768', width: 768, height: 1024, ua: UA_IPAD },
  { id: '1280', width: 1280, height: 800, ua: UA_DESKTOP },
  { id: '1440', width: 1440, height: 900, ua: UA_DESKTOP },
];

export type DeviceEmulation = { presetId: string; rotated: boolean } | null;

/** Per tab (in memory): the user-agent mode, a custom string, and the device size. */
export type TabDevtools = { uaMode: DevtoolsUaMode; customUa: string; device: DeviceEmulation };
export const DEFAULT_TAB_DEVTOOLS: TabDevtools = { uaMode: 'default', customUa: '', device: null };

/** The page width an emulated device gives (rotate swaps width and height), or null. */
export function emulatedWidth(device: DeviceEmulation): number | null {
  if (!device) return null;
  const preset = DEVICE_PRESETS.find((p) => p.id === device.presetId);
  if (!preset) return null;
  return device.rotated ? preset.height : preset.width;
}

/**
 * The WebView user agent devtools asks for, or undefined (the tab's own: default / desktop mode). Device emulation
 * wins over the mode; 'desktop' is the tab's desktop mode itself (B6), so it adds no override here.
 */
export function devtoolsUserAgent(state: TabDevtools | null | undefined, enabled: boolean): string | undefined {
  if (!enabled || !state) return undefined;
  if (state.device) return DEVICE_PRESETS.find((p) => p.id === state.device!.presetId)?.ua;
  switch (state.uaMode) {
    case 'iphone':
      return UA_IPHONE;
    case 'ipad':
      return UA_IPAD;
    case 'custom': {
      const ua = state.customUa.replace(/[\r\n]+/g, ' ').trim().slice(0, 512);
      return ua || undefined;
    }
    default:
      return undefined;
  }
}

// ---- user scripts (#199) ----

export type UserScriptRunAt = 'start' | 'end';

export type UserScript = {
  id: string;
  name: string;
  code: string;
  matches: string[];
  runAt: UserScriptRunAt;
  enabled: boolean;
  /** Runs in incognito tabs too (off by default). */
  allowIncognito: boolean;
};

export const MAX_USER_SCRIPT_LENGTH = 200_000;
export const MAX_MATCH_PATTERNS = 20;

const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * A match pattern as a regular-expression source, or null when invalid.
 * - Chrome match patterns: `<all_urls>`, `scheme://host/path` with `*` scheme (http/https), `*` / `*.example.com`
 *   host and `*` wildcards in the path.
 * - Anything else is a Greasemonkey `@include` glob: `*` matches anything.
 */
export function matchPatternSource(pattern: string): string | null {
  const p = pattern.trim();
  if (!p || p.length > 500) return null;
  if (p === '<all_urls>' || p === '*') return '^https?://';
  const chrome = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
  if (chrome) {
    const scheme = chrome[1] === '*' ? 'https?' : chrome[1];
    const host = chrome[2];
    const hostSource =
      host === '*'
        ? '[^/]+'
        : host.startsWith('*.')
          ? `(?:[^/]+\\.)?${escapeRegex(host.slice(2))}`
          : escapeRegex(host);
    const pathSource = chrome[3].split('*').map(escapeRegex).join('.*');
    return `^${scheme}://${hostSource}(?::\\d+)?${pathSource}$`;
  }
  if (/^[a-z*]+:\/\//i.test(p) || p.startsWith('*')) {
    return `^${p.split('*').map(escapeRegex).join('.*')}$`;
  }
  return null;
}

export function matchesUrl(patterns: readonly string[], url: string): boolean {
  return patterns.some((pattern) => {
    const source = matchPatternSource(pattern);
    return source != null && new RegExp(source).test(url);
  });
}

export type ParsedUserScript = {
  name: string;
  matches: string[];
  runAt: UserScriptRunAt;
  /** `@require` / `@resource` lines — never fetched (nothing is downloaded automatically). */
  ignored: number;
};

/** The `// ==UserScript==` header of a `.user.js` file, read as text. */
export function parseUserScriptHeader(text: string): ParsedUserScript {
  const header = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(text)?.[1] ?? '';
  let name = '';
  const matches: string[] = [];
  let runAt: UserScriptRunAt = 'end';
  let ignored = 0;
  for (const line of header.split(/\r?\n/)) {
    const m = /^\s*\/\/\s*@([\w:-]+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === 'name' && !name) name = value.slice(0, 80);
    else if ((key === 'match' || key === 'include') && matches.length < MAX_MATCH_PATTERNS) {
      if (matchPatternSource(value)) matches.push(value);
    } else if (key === 'run-at') runAt = value === 'document-start' ? 'start' : 'end';
    else if (key === 'require' || key === 'resource') ignored += 1;
  }
  return { name, matches, runAt, ignored };
}

/**
 * One user script as an isolated page snippet: it runs only when the page's address matches (checked in the page, at
 * run time — the document-start script also runs on later link navigations), inside `new Function` and try / catch, so
 * a syntax or runtime error never touches the rest of the injected code. It reports only its id (ran / failed).
 * Pages whose Content-Security-Policy forbids `unsafe-eval` refuse it (it then reports failed).
 */
export function userScriptSnippet(script: UserScript): string {
  const sources = script.matches.map(matchPatternSource).filter((s): s is string => s != null);
  return `(function () {
  try {
    var ok = false;
    var sources = ${JSON.stringify(sources)};
    for (var i = 0; i < sources.length; i++) { if (new RegExp(sources[i]).test(location.href)) { ok = true; break; } }
    if (!ok) return;
    var report = function (state) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${DEVTOOLS_MESSAGE}', kind: 'userscript', id: ${JSON.stringify(script.id)}, state: state })); } catch (e) {}
    };
    try {
      (new Function(${JSON.stringify(script.code.slice(0, MAX_USER_SCRIPT_LENGTH))}))();
      report('ran');
    } catch (e) {
      report('failed');
    }
  } catch (e) {}
})();`;
}

/** The scripts for a page: enabled, the right moment, and incognito only when allowed per script. */
export function userScriptsFor(scripts: readonly UserScript[], runAt: UserScriptRunAt, incognito: boolean): UserScript[] {
  return scripts.filter((s) => s.enabled && s.runAt === runAt && (!incognito || s.allowIncognito));
}

// ---- what is injected (the gate) ----

export const DEVTOOLS_MESSAGE = 'vidorax_devtools';
export const CONSOLE_LIMIT = 500;

/** #223: console messages and errors from the page's start, batched to the app (each cut to 2,000 characters). */
export const CONSOLE_CAPTURE_SCRIPT = `(function () {
  try {
    if (window.__vidoraxConsole) return;
    window.__vidoraxConsole = true;
    var queue = [];
    var timer = null;
    var flush = function () {
      timer = null;
      var batch = queue.splice(0, 50);
      if (!batch.length) return;
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${DEVTOOLS_MESSAGE}', kind: 'console', entries: batch })); } catch (e) {}
      if (queue.length) timer = setTimeout(flush, 250);
    };
    var text = function (value) {
      try {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.name + ': ' + value.message;
        return JSON.stringify(value);
      } catch (e) { return String(value); }
    };
    var push = function (level, args) {
      var parts = [];
      for (var i = 0; i < args.length; i++) parts.push(text(args[i]));
      queue.push({ level: level, text: parts.join(' ').slice(0, 2000), at: Date.now() });
      if (queue.length > 500) queue.splice(0, queue.length - 500);
      if (!timer) timer = setTimeout(flush, 250);
    };
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      var original = console[level];
      console[level] = function () {
        push(level, arguments);
        if (typeof original === 'function') return original.apply(console, arguments);
      };
    });
    window.addEventListener('error', function (event) {
      push('error', [(event.message || 'Error') + (event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '')]);
    });
    window.addEventListener('unhandledrejection', function (event) {
      push('error', ['Unhandled rejection: ' + text(event.reason)]);
    });
  } catch (e) {}
})();`;

/** #227: the page width of an emulated device, at document start and kept when the page changes its viewport tag. */
export function viewportScript(width: number): string {
  return `(function () {
  try {
    var content = 'width=${Math.max(200, Math.min(4000, Math.round(width)))}';
    var apply = function () {
      var root = document.documentElement;
      if (!root) return;
      var tags = document.querySelectorAll('meta[name="viewport"]');
      var tag = tags[0];
      for (var i = 1; i < tags.length; i++) tags[i].parentNode && tags[i].parentNode.removeChild(tags[i]);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', 'viewport');
        (document.head || root).appendChild(tag);
      }
      if (tag.getAttribute('content') !== content) tag.setAttribute('content', content);
    };
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  } catch (e) {}
})();`;
}

/**
 * Everything devtools adds at document start for a page: nothing at all while the tools are off; otherwise the
 * console capture, the emulated width, and the matching start-time user scripts.
 */
export function devtoolsDocumentStartScript(input: {
  enabled: boolean;
  tab: TabDevtools | null | undefined;
  scripts: readonly UserScript[];
  incognito: boolean;
}): string {
  if (!input.enabled) return '';
  const parts = [CONSOLE_CAPTURE_SCRIPT];
  const width = emulatedWidth(input.tab?.device ?? null);
  if (width != null) parts.push(viewportScript(width));
  for (const script of userScriptsFor(input.scripts, 'start', input.incognito)) parts.push(userScriptSnippet(script));
  return parts.join('\n');
}

/** The end-time user scripts to inject one by one after a page has loaded (nothing while off). */
export function userScriptsAtEnd(input: { enabled: boolean; scripts: readonly UserScript[]; incognito: boolean }): string[] {
  if (!input.enabled) return [];
  return userScriptsFor(input.scripts, 'end', input.incognito).map(userScriptSnippet);
}

// ---- messages from the page ----

export type ConsoleEntry = { level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result'; text: string; at: number };
export type NetworkEntry = { url: string; type: string; size: number | null; ms: number; status: number | null };
export type InspectInfo = {
  tag: string;
  id: string;
  classes: string[];
  width: number;
  height: number;
  styles: Record<string, string>;
  html: string;
  children: number;
  hasParent: boolean;
};
export type StorageItem = { area: 'local' | 'session'; key: string; value: string };

export type DevtoolsMessage =
  | { kind: 'console'; entries: ConsoleEntry[] }
  | { kind: 'eval'; ok: boolean; text: string }
  | { kind: 'network'; entries: NetworkEntry[]; mixed: number; https: boolean }
  | { kind: 'inspect'; info: InspectInfo | null }
  | { kind: 'source'; part: number; of: number; text: string; truncated: boolean }
  | { kind: 'storage'; items: StorageItem[] }
  | { kind: 'userscript'; id: string; state: 'ran' | 'failed' };

/** Bounded: anything bigger than this from a page is ignored (source comes in parts of at most 200,000). */
export const MAX_DEVTOOLS_MESSAGE = 300_000;

const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A page message for devtools, cleaned and bounded; undefined for anything else (a page can forge these: shown only). */
export function parseDevtoolsMessage(raw: string): DevtoolsMessage | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_DEVTOOLS_MESSAGE || !raw.includes(DEVTOOLS_MESSAGE)) return undefined;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!data || data.type !== DEVTOOLS_MESSAGE) return undefined;
  switch (data.kind) {
    case 'console': {
      const list = Array.isArray(data.entries) ? data.entries.slice(0, 50) : [];
      return {
        kind: 'console',
        entries: list.map((e: Record<string, unknown>) => ({
          level: (LEVELS.has(e?.level as string) ? e.level : 'log') as ConsoleEntry['level'],
          text: str(e?.text, 2000),
          at: num(e?.at) ?? Date.now(),
        })),
      };
    }
    case 'eval':
      return { kind: 'eval', ok: data.ok === true, text: str(data.text, 4000) };
    case 'network': {
      const list = Array.isArray(data.entries) ? data.entries.slice(0, 500) : [];
      return {
        kind: 'network',
        https: data.https === true,
        mixed: num(data.mixed) ?? 0,
        entries: list.map((e: Record<string, unknown>) => ({
          url: str(e?.url, 2048),
          type: str(e?.type, 32) || 'other',
          size: num(e?.size),
          ms: Math.max(0, Math.round(num(e?.ms) ?? 0)),
          status: num(e?.status),
        })),
      };
    }
    case 'inspect': {
      const i = data.info as Record<string, unknown> | null;
      if (!i) return { kind: 'inspect', info: null };
      const styles: Record<string, string> = {};
      if (i.styles && typeof i.styles === 'object') {
        for (const [k, v] of Object.entries(i.styles as Record<string, unknown>).slice(0, 20)) styles[k.slice(0, 40)] = str(v, 200);
      }
      return {
        kind: 'inspect',
        info: {
          tag: str(i.tag, 40),
          id: str(i.id, 200),
          classes: Array.isArray(i.classes) ? i.classes.slice(0, 30).map((c) => str(c, 100)) : [],
          width: Math.round(num(i.width) ?? 0),
          height: Math.round(num(i.height) ?? 0),
          styles,
          html: str(i.html, 4000),
          children: Math.max(0, num(i.children) ?? 0),
          hasParent: i.hasParent === true,
        },
      };
    }
    case 'source':
      return {
        kind: 'source',
        part: Math.max(0, num(data.part) ?? 0),
        of: Math.max(1, num(data.of) ?? 1),
        text: str(data.text, 200_000),
        truncated: data.truncated === true,
      };
    case 'storage': {
      const list = Array.isArray(data.items) ? data.items.slice(0, 500) : [];
      return {
        kind: 'storage',
        items: list.map((e: Record<string, unknown>) => ({
          area: e?.area === 'session' ? 'session' : 'local',
          key: str(e?.key, 500),
          value: str(e?.value, 2000),
        })),
      };
    }
    case 'userscript':
      return { kind: 'userscript', id: str(data.id, 64), state: data.state === 'failed' ? 'failed' : 'ran' };
    default:
      return undefined;
  }
}

/** Adds console entries, keeping the newest `CONSOLE_LIMIT`. */
export function appendConsole(list: readonly ConsoleEntry[], entries: readonly ConsoleEntry[]): ConsoleEntry[] {
  const next = [...list, ...entries];
  return next.length > CONSOLE_LIMIT ? next.slice(next.length - CONSOLE_LIMIT) : next;
}
