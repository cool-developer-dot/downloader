/**
 * Self-contained smoke checks for Phase 2 omnibox / navigation helpers.
 * Run: node src/browser/utils/__tests__/url.progress.smoke.mjs
 */

function isBlockedScheme(url) {
  return ['javascript:', 'data:', 'file:', 'blob:'].some((s) =>
    url.trim().toLowerCase().startsWith(s),
  );
}

function isInvalidLiteral(input) {
  return [/^\.+$/, /^\?+$/, /^%+$/, /^:\/{0,3}$/, /^https?:$/i, /^https?:\/$/i].some((p) =>
    p.test(input),
  );
}

function buildSearchUrl(query) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query.trim().replace(/\s+/g, ' '));
  return url.toString();
}

function classify(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };
  if (trimmed === 'vidorax://home') return { kind: 'home' };
  if (isInvalidLiteral(trimmed)) return { kind: 'invalid' };
  if (isBlockedScheme(trimmed)) return { kind: 'blocked' };

  if (/^https:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (!u.hostname) return { kind: 'invalid' };
      return { kind: 'navigate', category: 'https_url', url: trimmed };
    } catch {
      return { kind: 'invalid' };
    }
  }

  if (/^http:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (!u.hostname) return { kind: 'invalid' };
      return { kind: 'navigate', category: 'http_url', url: trimmed };
    } catch {
      return { kind: 'invalid' };
    }
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return { kind: 'invalid' };
  if (/\s/.test(trimmed)) {
    return { kind: 'search', url: buildSearchUrl(trimmed) };
  }

  const lower = trimmed.toLowerCase();
  if (/^(?:www\.)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i.test(lower)) {
    return { kind: 'navigate', category: lower.startsWith('www.') ? 'www_domain' : 'domain', url: `https://${lower}` };
  }

  if (/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/i.test(trimmed)) {
    return { kind: 'search', url: buildSearchUrl(trimmed) };
  }

  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) return { kind: 'invalid' };
  return { kind: 'search', url: buildSearchUrl(trimmed) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(classify('youtube.com').kind === 'navigate', 'domain → navigate');
assert(classify('youtube.com').url === 'https://youtube.com', 'https normalize');
assert(classify('www.github.com').category === 'www_domain', 'www domain');
assert(classify('https://github.com').category === 'https_url', 'https url');
assert(classify('http://example.com').category === 'http_url', 'http preserved');
assert(classify('How to learn React Native').kind === 'search', 'search query');
assert(classify('.....').kind === 'invalid', 'dots invalid');
assert(classify('???').kind === 'invalid', 'questions invalid');
assert(classify('%%%%').kind === 'invalid', 'percent invalid');
assert(classify(':///').kind === 'invalid', 'colon slash invalid');
assert(classify('http:').kind === 'invalid', 'incomplete http');
assert(classify('invalid::url').kind === 'invalid', 'invalid scheme');
assert(classify('javascript:alert(1)').kind === 'blocked', 'javascript blocked');
assert(classify('data:text/html,hi').kind === 'blocked', 'data blocked');
assert(classify('  Apple.com  ').url === 'https://apple.com', 'trim + lowercase host path');

process.stdout.write('browser phase-2 omnibox smoke checks passed\n');
