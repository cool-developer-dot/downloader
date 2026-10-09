/**
 * Finds the video a fetched page is about, from its bytes alone (no DOM, no scripts run):
 *
 * 1. **Declared** — what the page says its own video is: `og:video` / `twitter:player:stream`, a JSON-LD
 *    `VideoObject.contentUrl`.
 * 2. **Content** — data the page embeds (JSON script blocks, JSON assigned in scripts, element attributes) that is
 *    tied to the pasted link's content id: the URL sits in an object that carries the id the link names
 *    (`/reel/<code>`, `?v=<id>`, `/video/<id>`), and not inside a list of other items.
 * 3. **Single** — failing both, a page whose markup and text name exactly one distinct video file.
 *
 * Anything else — related videos, a feed, ads, several players — is left for the WebView, which knows what plays:
 * `ambiguous`, never a guess. Declared player pages (`og:video` of type text/html, `twitter:player`, JSON-LD
 * `embedUrl`) are returned for the caller to read one level deep. Only generic structure is used: no site is named.
 */

import { contentTokensOf, ID_KEY, ownershipOf, valueNamesToken } from './content-tokens';
import {
  decodeHtmlEntities,
  elementText,
  jsonValuesInScript,
  parseEmbeddedJson,
  parseTagAt,
  scanTags,
  scriptBlocks,
  unescapeScriptText,
} from './html-scan';
import { bestInlineDashSource, isoDurationMs, looksLikeInlineDash, parseInlineDash, type InlineDash } from './inline-dash';
import {
  classifyMediaUrl,
  qualityFromKey,
  resolvePageUrl,
  resourceKey,
  type DirectSourceKind,
  type MediaUrlHint,
} from './media-url';

export type DirectEvidence = 'declared' | 'content' | 'single' | 'direct';

export type DirectOrigin =
  | 'og_video'
  | 'twitter_stream'
  | 'json_ld'
  | 'video_element'
  | 'element_attribute'
  | 'embedded_json'
  | 'inline_manifest'
  | 'page_text'
  | 'direct_link';

export type DirectMediaCandidate = {
  url: string;
  /** `split`: `url` is the video-only file and `audioUrl` its audio file. null: the bytes decide. */
  kind: DirectSourceKind | 'split' | null;
  audioUrl: string | null;
  evidence: DirectEvidence;
  origin: DirectOrigin;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  qualityLabel: string | null;
  durationMs: number | null;
};

export type PageMediaExtraction = {
  title: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  canonicalUrl: string | null;
  /** The page's own video, best evidence first; empty when it could not be proven. */
  candidates: DirectMediaCandidate[];
  /** Video URLs were found, but none could be tied to the page's own video. */
  ambiguous: boolean;
  /** Declared embedded-player pages (depth-1 follow for the caller). */
  playerPageUrls: string[];
  /** The page declares its video live. */
  live: boolean;
  /** Protection evidence around the page's own video (an inline manifest's ContentProtection, DRM fields). */
  protected: boolean;
  /** How many distinct video URLs the page named at all (diagnostics). */
  mediaUrlCount: number;
};

/** Bytes of HTML examined; the fetcher bounds the body already, this bounds the work. */
const MAX_HTML_LENGTH = 4 * 1024 * 1024;
const MAX_JSON_NODES = 300_000;
const MAX_SCRIPT_JSON_LENGTH = 4 * 1024 * 1024;
const MAX_TOTAL_SCRIPT_JSON = 8 * 1024 * 1024;
/** How far up a data tree a content id may sit from the URL it vouches for. */
const MAX_MATCH_DISTANCE = 5;
const MAX_CANDIDATES = 12;

const LIVE_KEY = /^(?:is_?live|is_?live_?stream(?:ing)?|live_?now|is_?broadcast(?:ing)?|isLiveBroadcast)$/i;
const PROTECTED_KEY = /^(?:drm\w*|widevine\w*|playready\w*|fairplay\w*|license_?(?:url|uri|server)\w*|is_?drm\w*|is_?encrypted)$/i;
const DATA_ATTRIBUTE = /\sdata-[a-z0-9-]*(?:video|src|stream|file|mp4|hls|dash|url|source)[a-z0-9-]*\s*=/gi;

type Hit = {
  url: string;
  hint: MediaUrlHint;
  origin: DirectOrigin;
  /** Distance (in objects) to the content id that vouches for it; null when none does. */
  match: number | null;
  /** It provably belongs to another item (another id, or an entry of a list of items): never the page's video. */
  foreign?: boolean;
  /** Items that are the same video for the single-video rule (a `<video>` element's sources). */
  group: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  qualityLabel: string | null;
  live: boolean;
  protected: boolean;
};

type ManifestHit = { dash: InlineDash; match: number | null };

type Frame = { kind: 'object'; value: Record<string, unknown> } | { kind: 'array'; value: unknown[] };

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanText(value: string | null | undefined, max = 200): string | null {
  const text = value ? decodeHtmlEntities(value).replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
}

/** A list of several distinct items (a feed, related videos, a carousel): a URL inside one belongs to its item. */
function isItemList(list: unknown[], tokens: ReadonlySet<string>): boolean {
  const ids = new Set<string>();
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      if (ID_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
        const text = String(value);
        if (tokens.has(text)) {
          // The page's own item sits in this list: the walk-up from it finds its id before reaching the list.
          continue;
        }
        ids.add(text);
        break;
      }
    }
    if (ids.size >= 2) {
      return true;
    }
  }
  return false;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * A DASH/adaptive representation described as data (`representation_id`, or a MIME type and codecs of one track):
 * one track of a video — never offered as the video. Its manifest, or the page's muxed files, stand for the video.
 */
function isTrackRepresentation(owner: Record<string, unknown> | null): boolean {
  if (!owner) {
    return false;
  }
  if (Object.keys(owner).some((key) => /^representation_?id$/i.test(key))) {
    return true;
  }
  const mime = String(owner.mime_type ?? owner.mimeType ?? owner.content_type ?? owner.contentType ?? '').toLowerCase();
  const codecs = String(owner.codecs ?? owner.codec ?? '').toLowerCase();
  if (mime.startsWith('audio/')) {
    return true;
  }
  return /avc|hvc|hev|vp0?8|vp0?9|av01/.test(codecs) && !/mp4a|opus|vorbis|ac-3|ec-3|flac/.test(codecs);
}

/** Attributes as data fields (`data-video-id` → `video_id`), with JSON-valued attributes' own top-level fields. */
function attributeFields(attrs: Record<string, string>): [string, unknown][] {
  const fields: [string, unknown][] = [];
  for (const [name, value] of Object.entries(attrs)) {
    fields.push([name.replace(/^data-/, '').replace(/-/g, '_'), value]);
    const trimmed = value.trim();
    if (trimmed.length > 2 && trimmed.length < 64 * 1024 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      const parsed = parseEmbeddedJson(trimmed);
      const stack: { value: unknown; depth: number }[] = [{ value: parsed, depth: 0 }];
      while (stack.length > 0 && fields.length < 2_000) {
        const { value: node, depth } = stack.pop()!;
        if (!node || typeof node !== 'object' || depth > 2) continue;
        for (const [key, child] of Array.isArray(node) ? node.map((v, i) => [String(i), v] as const) : Object.entries(node)) {
          if (child && typeof child === 'object') {
            stack.push({ value: child, depth: depth + 1 });
          } else {
            fields.push([key, child]);
          }
        }
      }
    }
  }
  return fields;
}

class JsonWalker {
  nodes = 0;
  readonly hits: Hit[] = [];
  readonly manifests: ManifestHit[] = [];
  private readonly keyPath: string[] = [];
  private readonly frames: Frame[] = [];

  private readonly tokens: ReadonlySet<string>;
  private readonly baseUrl: string;

  constructor(tokens: ReadonlySet<string>, baseUrl: string) {
    this.tokens = tokens;
    this.baseUrl = baseUrl;
  }

  walk(root: unknown): void {
    this.visit(root);
  }

  private visit(node: unknown): void {
    if (this.nodes >= MAX_JSON_NODES) {
      return;
    }
    this.nodes += 1;
    if (typeof node === 'string') {
      this.onString(node);
      return;
    }
    if (Array.isArray(node)) {
      this.frames.push({ kind: 'array', value: node });
      for (const item of node.length > 5_000 ? node.slice(0, 5_000) : node) {
        this.visit(item);
      }
      this.frames.pop();
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      this.frames.push({ kind: 'object', value: record });
      for (const key of Object.keys(record)) {
        this.keyPath.push(key);
        this.visit(record[key]);
        this.keyPath.pop();
      }
      this.frames.pop();
    }
  }

  private onString(value: string): void {
    if (value.length > 64 && looksLikeInlineDash(value)) {
      const dash = parseInlineDash(value, this.baseUrl);
      const ownership = this.ownership();
      if (dash && ownership !== 'foreign') {
        this.manifests.push({ dash, match: typeof ownership === 'number' ? ownership : null });
      }
      return;
    }
    const first = value.charCodeAt(0);
    // 'h' (http…), '/' (//host or /path): anything else is not a link.
    if ((first !== 104 && first !== 47) || value.length > 4096) {
      return;
    }
    if (first === 47 && value[1] !== '/' && !/\.(?:mp4|m4v|webm|mov|m3u8|mpd)(?:\?|$)/i.test(value)) {
      return;
    }
    if (first === 104 && !value.startsWith('http://') && !value.startsWith('https://')) {
      return;
    }
    const url = resolvePageUrl(value, this.baseUrl);
    if (!url) {
      return;
    }
    const hint = classifyMediaUrl(url, this.keyPath);
    if (!hint) {
      return;
    }
    // Only its field says "video": a link back into the page's own site is a page, not a file.
    if (hint.strength === 'keyed' && sameHost(url, this.baseUrl)) {
      return;
    }
    const owner = this.nearestObject();
    if (isTrackRepresentation(owner)) {
      return;
    }
    const key = this.keyPath[this.keyPath.length - 1] ?? null;
    const ownership = this.ownership();
    const match = typeof ownership === 'number' ? ownership : null;
    const flags = this.flagsUpTo(match ?? 1);
    this.hits.push({
      url,
      hint,
      origin: 'embedded_json',
      match,
      foreign: ownership === 'foreign',
      group: null,
      mimeType: typeof owner?.mime_type === 'string' ? owner.mime_type : typeof owner?.mimeType === 'string' ? owner.mimeType : null,
      width: positiveNumber(owner?.width ?? owner?.original_width),
      height: positiveNumber(owner?.height ?? owner?.original_height),
      bitrate: positiveNumber(owner?.bitrate ?? owner?.bandwidth),
      qualityLabel:
        (typeof owner?.quality_label === 'string' && owner.quality_label) ||
        (typeof owner?.qualityLabel === 'string' && owner.qualityLabel) ||
        qualityFromKey(key),
      live: flags.live,
      protected: flags.protected,
    });
  }

  private nearestObject(): Record<string, unknown> | null {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i]!;
      if (frame.kind === 'object') {
        return frame.value;
      }
    }
    return null;
  }

  /**
   * Objects between this value and the nearest one carrying a content id the link names; `foreign` when an object on
   * the way carries another item's id or the way crosses a list of items; null when nothing says either way.
   */
  private ownership(): number | 'foreign' | null {
    let depth = 0;
    for (let i = this.frames.length - 1; i >= 0 && depth <= MAX_MATCH_DISTANCE; i -= 1) {
      const frame = this.frames[i]!;
      if (frame.kind === 'array') {
        if (isItemList(frame.value, this.tokens)) {
          return 'foreign';
        }
        continue;
      }
      const owner = ownershipOf(Object.entries(frame.value), this.tokens);
      if (owner === 'match') {
        return depth;
      }
      if (owner === 'foreign') {
        return 'foreign';
      }
      depth += 1;
    }
    return null;
  }

  private flagsUpTo(levels: number): { live: boolean; protected: boolean } {
    let live = false;
    let isProtected = false;
    let depth = 0;
    for (let i = this.frames.length - 1; i >= 0 && depth <= levels; i -= 1) {
      const frame = this.frames[i]!;
      if (frame.kind !== 'object') {
        continue;
      }
      for (const [key, value] of Object.entries(frame.value)) {
        if (LIVE_KEY.test(key) && value === true) {
          live = true;
        }
        if (PROTECTED_KEY.test(key) && (value === true || (typeof value === 'string' && value.length > 0) || (value && typeof value === 'object'))) {
          isProtected = true;
        }
      }
      depth += 1;
    }
    return { live, protected: isProtected };
  }
}

type VideoObjectInfo = {
  contentUrls: string[];
  embedUrl: string | null;
  name: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  live: boolean;
  namesPage: boolean;
};

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(asStrings);
  }
  if (value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string') {
    return [(value as { url: string }).url];
  }
  return [];
}

function collectVideoObjects(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || out.length > 20 || !node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.slice(0, 100).forEach((item) => collectVideoObjects(item, out, depth + 1));
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && /VideoObject|Clip|Movie|Episode/i.test(t))) {
    out.push(record);
  }
  for (const key of ['@graph', 'video', 'hasPart', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'associatedMedia']) {
    if (record[key]) {
      collectVideoObjects(record[key], out, depth + 1);
    }
  }
}

function videoObjectInfo(record: Record<string, unknown>, pageUrl: string, tokens: ReadonlySet<string>): VideoObjectInfo {
  const resolve = (value: string) => resolvePageUrl(value, pageUrl);
  const contentUrls = asStrings(record.contentUrl).map(resolve).filter((u): u is string => Boolean(u));
  const embedUrl = asStrings(record.embedUrl).map(resolve).find(Boolean) ?? null;
  const publication = record.publication as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const publications = Array.isArray(publication) ? publication : publication ? [publication] : [];
  const live = record.isLiveBroadcast === true || publications.some((p) => p?.isLiveBroadcast === true);
  const namesPage = [record.url, record['@id'], record.embedUrl, record.contentUrl, record.identifier]
    .flatMap(asStrings)
    .some((value) => valueNamesToken(value, tokens) || [...tokens].some((token) => value === token));
  return {
    contentUrls,
    embedUrl,
    name: cleanText(typeof record.name === 'string' ? record.name : null),
    thumbnailUrl: asStrings(record.thumbnailUrl).map(resolve).find(Boolean) ?? null,
    durationMs: isoDurationMs(typeof record.duration === 'string' ? record.duration : null),
    live,
    namesPage,
  };
}

/** Text-level scan for video URLs anywhere (inline JavaScript, attributes), for the single-video rule only. */
function scanPageText(html: string, baseUrl: string): string[] {
  const text = unescapeScriptText(html);
  const found = new Set<string>();
  const marker = /\.(?:mp4|m4v|webm|mov|m3u8|mpd)(?=[?"'\s<>&\\)]|$)|[?&]mime_?type=video/gi;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) && found.size < 64) {
    const at = match.index;
    const start = text.lastIndexOf('http', at);
    if (start < 0 || at - start > 2048) {
      continue;
    }
    const between = text.slice(start, at);
    if (/[\s"'<>()]/.test(between)) {
      continue;
    }
    let end = at + match[0].length;
    while (end < text.length && end - start < 4096 && !/[\s"'<>\\)]/.test(text[end]!)) {
      end += 1;
    }
    const raw = decodeHtmlEntities(text.slice(start, end));
    const url = resolvePageUrl(raw, baseUrl);
    if (url && classifyMediaUrl(url)?.strength === 'strong') {
      found.add(url);
    }
  }
  return [...found];
}

function plainHit(url: string, hint: MediaUrlHint, origin: DirectOrigin, match: number | null = null): Hit {
  return {
    url,
    hint,
    origin,
    match,
    group: null,
    mimeType: null,
    width: null,
    height: null,
    bitrate: null,
    qualityLabel: null,
    live: false,
    protected: false,
  };
}

function hintOfType(type: string | null | undefined): DirectSourceKind | null {
  const t = (type ?? '').toLowerCase();
  if (/mpegurl/.test(t)) return 'hls';
  if (/dash\+xml/.test(t)) return 'dash';
  if (t.startsWith('video/')) return 'progressive';
  return null;
}

export function extractPageMedia(input: {
  html: string;
  pageUrl: string;
  requestedUrl?: string | null;
}): PageMediaExtraction {
  const html = input.html.length > MAX_HTML_LENGTH ? input.html.slice(0, MAX_HTML_LENGTH) : input.html;
  const pageUrl = input.pageUrl;

  // Metadata ---------------------------------------------------------------------------------------------------------
  const meta = new Map<string, string[]>();
  for (const tag of scanTags(html, ['meta'], 3_000)) {
    const name = (tag.attrs.property ?? tag.attrs.name ?? tag.attrs.itemprop ?? '').trim().toLowerCase();
    const content = tag.attrs.content;
    if (name && content) {
      meta.set(name, [...(meta.get(name) ?? []), content.trim()]);
    }
  }
  const first = (...names: string[]) => names.map((n) => meta.get(n)?.[0]).find((v) => v != null) ?? null;
  let canonicalUrl: string | null = null;
  for (const tag of scanTags(html, ['link'], 500)) {
    if ((tag.attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical') && tag.attrs.href) {
      canonicalUrl = resolvePageUrl(tag.attrs.href, pageUrl);
      break;
    }
  }
  const ogUrl = first('og:url');
  const tokens = contentTokensOf([input.requestedUrl, pageUrl, canonicalUrl, ogUrl ? resolvePageUrl(ogUrl, pageUrl) : null]);

  const titleTag = (() => {
    const tag = scanTags(html, ['title'], 1)[0];
    return tag ? elementText(html, tag, 4_096)?.text ?? null : null;
  })();
  let title = cleanText(first('og:title', 'twitter:title')) ?? cleanText(titleTag);
  let thumbnailUrl = [first('og:image:secure_url', 'og:image', 'twitter:image')].map((v) => (v ? resolvePageUrl(v, pageUrl) : null))[0] ?? null;
  let durationMs = (() => {
    const seconds = positiveNumber(first('og:video:duration', 'video:duration'));
    return seconds ? Math.round(seconds * 1000) : null;
  })();

  const hits: Hit[] = [];
  const manifests: ManifestHit[] = [];
  const playerPages: string[] = [];
  const addPlayerPage = (url: string | null) => {
    if (url && url !== pageUrl && !playerPages.includes(url)) {
      playerPages.push(url);
    }
  };
  let live = false;

  // Declared: OpenGraph / Twitter ----------------------------------------------------------------------------------
  const ogType = first('og:video:type');
  for (const name of ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']) {
    for (const value of meta.get(name) ?? []) {
      const url = resolvePageUrl(value, pageUrl);
      if (!url) continue;
      const type = name === 'twitter:player:stream' ? first('twitter:player:stream:content_type') : ogType;
      const hint = classifyMediaUrl(url);
      const typed = hintOfType(type);
      if ((type && /text\/html/i.test(type)) || (!hint && !typed)) {
        addPlayerPage(url);
        continue;
      }
      // og:video:width/height describe the player box as often as the file: never used as the quality.
      hits.push({
        ...plainHit(url, { kind: typed ?? hint?.kind ?? null, strength: 'strong' }, name === 'twitter:player:stream' ? 'twitter_stream' : 'og_video', 0),
        mimeType: type && /^video\/|mpegurl|dash/i.test(type) ? type : null,
      });
    }
  }
  addPlayerPage(first('twitter:player') ? resolvePageUrl(first('twitter:player')!, pageUrl) : null);

  // Declared: JSON-LD, and embedded JSON ----------------------------------------------------------------------------
  const walker = new JsonWalker(tokens, pageUrl);
  let jsonBudget = MAX_TOTAL_SCRIPT_JSON;
  const scripts = scriptBlocks(html);
  const videoObjects: VideoObjectInfo[] = [];
  for (const script of scripts) {
    const type = (script.attrs.type ?? '').toLowerCase();
    if (type.includes('ld+json')) {
      const parsed = parseEmbeddedJson(script.text);
      const records: Record<string, unknown>[] = [];
      collectVideoObjects(parsed, records);
      videoObjects.push(...records.map((record) => videoObjectInfo(record, pageUrl, tokens)));
      continue;
    }
    if (script.text.length > MAX_SCRIPT_JSON_LENGTH || script.text.length > jsonBudget) {
      continue;
    }
    if (type.includes('json')) {
      jsonBudget -= script.text.length;
      const parsed = parseEmbeddedJson(script.text);
      if (parsed !== undefined) {
        walker.walk(parsed);
      }
    } else if (!type || type.includes('javascript') || type === 'module') {
      if (!/https?:|\.m3u8|\.mpd|\.mp4/.test(script.text)) {
        continue;
      }
      jsonBudget -= script.text.length;
      for (const value of jsonValuesInScript(script.text)) {
        walker.walk(value);
      }
    }
  }
  // Several VideoObjects: only one that names the pasted content (or the only one) speaks for the page.
  const ownVideoObjects =
    videoObjects.length === 1 ? videoObjects : videoObjects.filter((info) => info.namesPage);
  for (const info of ownVideoObjects) {
    for (const url of info.contentUrls) {
      hits.push({ ...plainHit(url, classifyMediaUrl(url) ?? { kind: null, strength: 'keyed' }, 'json_ld', 0), live: info.live });
    }
    addPlayerPage(info.embedUrl);
    live = live || info.live;
    title = title ?? info.name;
    thumbnailUrl = thumbnailUrl ?? info.thumbnailUrl;
    durationMs = durationMs ?? info.durationMs;
  }
  hits.push(...walker.hits);
  manifests.push(...walker.manifests);

  // Markup: <video>/<source>, and data-* attributes --------------------------------------------------------------
  const pool: Hit[] = [];
  const videoTags = scanTags(html, ['video'], 200);
  videoTags.forEach((tag, index) => {
    const group = `video#${index}`;
    const body = elementText(html, tag, 256 * 1024);
    const sources: { src: string; type: string | null }[] = [];
    if (tag.attrs.src) sources.push({ src: tag.attrs.src, type: tag.attrs.type ?? null });
    for (const source of body ? scanTags(body.text, ['source'], 20) : []) {
      if (source.attrs.src) sources.push({ src: source.attrs.src, type: source.attrs.type ?? null });
    }
    const elementOwner = ownershipOf(attributeFields(tag.attrs), tokens);
    const namesContent = elementOwner === 'match';
    for (const source of sources) {
      const url = resolvePageUrl(source.src, pageUrl);
      if (!url) continue;
      const typed = hintOfType(source.type);
      const hint = classifyMediaUrl(url) ?? (typed ? { kind: typed, strength: 'strong' as const } : null);
      if (!hint) continue;
      const hit: Hit = {
        url,
        hint: typed ? { kind: typed, strength: 'strong' } : hint,
        origin: 'video_element',
        match: namesContent ? 0 : null,
        foreign: elementOwner === 'foreign',
        group,
        mimeType: source.type,
        width: positiveNumber(tag.attrs.width),
        height: positiveNumber(tag.attrs.height),
        bitrate: null,
        qualityLabel: null,
        live: false,
        protected: false,
      };
      (namesContent ? hits : pool).push(hit);
    }
  });

  let attribute: RegExpExecArray | null;
  const seenTags = new Set<number>();
  DATA_ATTRIBUTE.lastIndex = 0;
  while ((attribute = DATA_ATTRIBUTE.exec(html)) && seenTags.size < 200) {
    const start = html.lastIndexOf('<', attribute.index);
    if (start < 0 || seenTags.has(start)) continue;
    seenTags.add(start);
    const tag = parseTagAt(html, start);
    if (!tag) continue;
    const tagOwner = ownershipOf(attributeFields(tag.attrs), tokens);
    const namesContent = tagOwner === 'match';
    for (const [name, value] of Object.entries(tag.attrs)) {
      if (!name.startsWith('data-')) continue;
      const url = resolvePageUrl(value, pageUrl);
      if (!url) continue;
      const hint = classifyMediaUrl(url, [name.slice(5).replace(/-/g, '_')]);
      if (!hint) continue;
      const hit: Hit = {
        url,
        hint,
        origin: 'element_attribute',
        match: namesContent ? 0 : null,
        foreign: tagOwner === 'foreign',
        group: null,
        mimeType: null,
        width: null,
        height: null,
        bitrate: null,
        qualityLabel: qualityFromKey(name.slice(5).replace(/-/g, '_')),
        live: false,
        protected: false,
      };
      (namesContent ? hits : pool).push(hit);
    }
  }

  // Selection -------------------------------------------------------------------------------------------------------
  const declared = hits.filter((hit) => hit.origin === 'og_video' || hit.origin === 'twitter_stream' || hit.origin === 'json_ld');
  const content = hits.filter((hit) => !declared.includes(hit) && hit.match != null);
  const unmatched = hits.filter((hit) => !declared.includes(hit) && hit.match == null);
  const ownManifests = manifests.filter((manifest) => manifest.match != null);

  const candidates: DirectMediaCandidate[] = [];
  const toCandidate = (hit: Hit, evidence: DirectEvidence): DirectMediaCandidate => ({
    url: hit.url,
    kind: hit.hint.kind,
    audioUrl: null,
    evidence,
    origin: hit.origin,
    mimeType: hit.mimeType,
    width: hit.width,
    height: hit.height,
    bitrate: hit.bitrate,
    qualityLabel: hit.qualityLabel,
    durationMs,
  });
  for (const hit of declared) candidates.push(toCandidate(hit, 'declared'));
  for (const hit of [...content].sort((a, b) => (a.match ?? 0) - (b.match ?? 0))) candidates.push(toCandidate(hit, 'content'));
  let isProtected = [...declared, ...content].some((hit) => hit.protected) || ownManifests.some((m) => m.dash.protected);
  live = live || [...declared, ...content].some((hit) => hit.live) || ownManifests.some((m) => m.dash.live);
  for (const manifest of ownManifests) {
    const best = bestInlineDashSource(manifest.dash);
    if (!best) continue;
    candidates.push({
      url: best.url,
      kind: best.audioUrl ? 'split' : 'progressive',
      audioUrl: best.audioUrl,
      evidence: 'content',
      origin: 'inline_manifest',
      mimeType: null,
      width: best.width,
      height: best.height,
      bitrate: null,
      qualityLabel: best.label,
      durationMs: manifest.dash.durationMs ?? durationMs,
    });
  }

  // Everything that names a video but is tied to nothing: one distinct video on the whole page is the page's video.
  // What provably belongs to another item never counts — and neither does the page text when such items exist.
  const foreignUrls = new Set([...unmatched, ...pool].filter((hit) => hit.foreign).map((hit) => resourceKey(hit.url)));
  const loose = [...unmatched, ...pool].filter((hit) => !hit.foreign);
  // The whole-text scan only matters when nothing better named the video (it is the costliest pass on a big page).
  const textUrls =
    candidates.length === 0 ? scanPageText(html, pageUrl).filter((url) => !foreignUrls.has(resourceKey(url))) : [];
  const groups = new Map<string, string>();
  const groupOf = (url: string, group: string | null) => {
    const key = resourceKey(url);
    const existing = groups.get(key);
    const id = existing ?? group ?? key;
    groups.set(key, id);
    return id;
  };
  for (const hit of loose) groupOf(hit.url, hit.group);
  for (const url of textUrls) groupOf(url, null);
  for (const manifest of manifests.filter((m) => m.match == null)) {
    const best = bestInlineDashSource(manifest.dash);
    if (best) groupOf(best.url, null);
  }
  const allUrls = new Set([...hits.map((h) => resourceKey(h.url)), ...groups.keys()]);

  let ambiguous = false;
  if (candidates.length === 0) {
    const distinct = new Set(groups.values());
    if (distinct.size === 1 && foreignUrls.size === 0) {
      const seen = new Set<string>();
      for (const hit of loose) {
        if (!seen.has(hit.url)) {
          seen.add(hit.url);
          candidates.push(toCandidate(hit, 'single'));
        }
      }
      for (const url of textUrls) {
        const hint = classifyMediaUrl(url);
        if (hint && !seen.has(url)) {
          seen.add(url);
          candidates.push(toCandidate(plainHit(url, hint, 'page_text'), 'single'));
        }
      }
      for (const manifest of manifests) {
        const best = bestInlineDashSource(manifest.dash);
        if (!best || seen.has(best.url)) continue;
        seen.add(best.url);
        isProtected = isProtected || manifest.dash.protected;
        live = live || manifest.dash.live;
        candidates.push({
          url: best.url,
          kind: best.audioUrl ? 'split' : 'progressive',
          audioUrl: best.audioUrl,
          evidence: 'single',
          origin: 'inline_manifest',
          mimeType: null,
          width: best.width,
          height: best.height,
          bitrate: null,
          qualityLabel: best.label,
          durationMs: manifest.dash.durationMs ?? durationMs,
        });
      }
    } else if (distinct.size > 1 || foreignUrls.size > 0) {
      ambiguous = true;
    }
  }

  return {
    title,
    thumbnailUrl,
    durationMs,
    canonicalUrl,
    candidates: dedupeCandidates(candidates).slice(0, MAX_CANDIDATES),
    ambiguous,
    playerPageUrls: playerPages.slice(0, 3),
    live,
    protected: isProtected,
    mediaUrlCount: allUrls.size,
  };
}

/** One entry per URL (pair), keeping the strongest evidence and the richest metadata. */
function dedupeCandidates(candidates: DirectMediaCandidate[]): DirectMediaCandidate[] {
  const byUrl = new Map<string, DirectMediaCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.url}|${candidate.audioUrl ?? ''}`;
    const prior = byUrl.get(key);
    if (!prior) {
      byUrl.set(key, candidate);
      continue;
    }
    byUrl.set(key, {
      ...prior,
      kind: prior.kind ?? candidate.kind,
      mimeType: prior.mimeType ?? candidate.mimeType,
      width: prior.width ?? candidate.width,
      height: prior.height ?? candidate.height,
      bitrate: prior.bitrate ?? candidate.bitrate,
      qualityLabel: prior.qualityLabel ?? candidate.qualityLabel,
    });
  }
  return [...byUrl.values()];
}
