/**
 * The ids a pasted link names its video by — path segments and query values shaped like content ids (`DdiUOZezpFs`,
 * `6718335390845095173`, `xb346be`). Data on the page that carries one of them describes the pasted video, not the
 * related videos, ads and feed items around it. Generic: no site's URL layout is known here.
 */

/** Path words that name a kind of page, never a video. */
const ROUTE_WORDS = new Set([
  'video', 'videos', 'watch', 'reel', 'reels', 'embed', 'player', 'p', 'v', 'tv', 'clip', 'clips', 'shorts', 'post',
  'posts', 'status', 'media', 'story', 'stories', 'share', 'amp', 'www', 'm', 'index', 'html', 'php', 'mobile',
]);

/** Query keys that carry tracking or state, not content. */
const NOISE_QUERY = /^(?:utm_.*|fbclid|gclid|igsh|igshid|si|ref|ref_src|s|t|start|autoplay|mute|muted|lang|hl|locale|_rdr|rdid|mibextid|share_.*|is_from_webapp|sender_device|web_id|_r|_t)$/i;

const ID_SHAPE = /^[A-Za-z0-9_-]{5,64}$/;

/** Looks like an id rather than a word: has a digit, or mixes upper and lower case (a shortcode). */
export function isContentIdLike(value: string): boolean {
  if (!ID_SHAPE.test(value) || ROUTE_WORDS.has(value.toLowerCase())) {
    return false;
  }
  // A slug (`some-story-title-8812345`) is words, not an id; its trailing id is taken on its own.
  if (value.split(/[-_]/).filter((part) => /^[A-Za-z]{3,}$/.test(part)).length >= 2) {
    return false;
  }
  if (/\d/.test(value)) {
    // Ids with digits; plain years and short counters are not ids.
    return value.length >= 6 || /[A-Za-z]/.test(value);
  }
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && value.length >= 8;
}

/** Content ids named by any of `urls` (the pasted link, where it redirected to, the page's canonical URL). */
export function contentTokensOf(urls: readonly (string | null | undefined)[]): Set<string> {
  const tokens = new Set<string>();
  for (const raw of urls) {
    if (!raw) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    for (const segment of url.pathname.split('/')) {
      let value: string;
      try {
        value = decodeURIComponent(segment);
      } catch {
        value = segment;
      }
      // `@user` is the author, shared by every video of theirs.
      if (!value.startsWith('@') && isContentIdLike(value)) {
        tokens.add(value);
      }
      // `name-of-the-video-123456` / `x8abc12.html`: the trailing id.
      const tail = /[-_.]([A-Za-z0-9]{6,32})(?:\.[a-z]{2,5})?$/.exec(value)?.[1];
      if (tail && /\d/.test(tail) && isContentIdLike(tail)) {
        tokens.add(tail);
      }
    }
    for (const [key, value] of url.searchParams) {
      if (!NOISE_QUERY.test(key) && isContentIdLike(value)) {
        tokens.add(value);
      }
    }
  }
  return tokens;
}

/** Whether `value` (a data field's text) is, or is a link naming, one of `tokens`. */
export function valueNamesToken(value: string, tokens: ReadonlySet<string>): boolean {
  if (tokens.size === 0 || !value || value.length > 64 * 1024) {
    return false;
  }
  if (tokens.has(value)) {
    return true;
  }
  // Inside a link, a query, or a JSON-valued attribute: the id as a whole word.
  for (const token of tokens) {
    for (let at = value.indexOf(token); at >= 0; at = value.indexOf(token, at + 1)) {
      const before = at === 0 ? '' : value[at - 1]!;
      const after = value[at + token.length] ?? '';
      if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether `a` and `b` are ids of the same kind (both numeric of about the same length, or both alphanumeric of about
 * the same length) — so a field holding `b` where the page's id is `a` names another item.
 */
export function sameIdShape(a: string, b: string): boolean {
  const numeric = (v: string) => /^\d+$/.test(v);
  if (numeric(a) !== numeric(b)) {
    return false;
  }
  return Math.abs(a.length - b.length) <= (numeric(a) ? 3 : 2);
}

/** Data fields that identify an item (the video, a post, a related item). */
export const ID_KEY =
  /^(?:id|pk|code|shortcode|short_?code|video_?id|media_?id|item_?id|aweme_?id|post_?id|xid|content_?id|videoId|mediaId|itemId|contentId)$/i;

/**
 * Whose data `fields` are: `match` when an id field holds a content id of the pasted link (or, with no id field
 * saying otherwise, any field names one); `foreign` when an id field holds another id of the same shape — another
 * item, whatever else it links (a related reel's `origin_uri` names the page it was found on); `none` otherwise.
 */
export function ownershipOf(
  fields: Iterable<readonly [string, unknown]>,
  tokens: ReadonlySet<string>,
): 'match' | 'foreign' | 'none' {
  if (tokens.size === 0) {
    return 'none';
  }
  let reference = false;
  let foreign = false;
  for (const [key, value] of fields) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue;
    }
    const text = String(value);
    if (ID_KEY.test(key)) {
      if (tokens.has(text)) {
        return 'match';
      }
      if (isContentIdLike(text) && [...tokens].some((token) => sameIdShape(token, text))) {
        foreign = true;
      }
      continue;
    }
    if (!reference && valueNamesToken(text, tokens)) {
      reference = true;
    }
  }
  if (foreign) {
    return 'foreign';
  }
  return reference ? 'match' : 'none';
}
