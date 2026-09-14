/**
 * Phase 6B — Session-aware media request context verifier.
 *
 * Usage (from mobile/):
 *   npm run verify:phase6b-session-aware-media-access
 *
 * Deterministic TypeScript — no Maestro / Appium / Python / expo prebuild.
 * Imports RN-free session-media helpers + static architecture checks.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyAuthLikeFailure,
  classifyPostSessionFailure,
  isAuthLikeFailure,
  resolveAccessClassAfterFailure,
} from '../src/media-detection/session-media/auth-failure.classifier';
import {
  filterSessionMediaHeaders,
  stripSecretRequestHeaders,
  SESSION_MEDIA_ALLOWED_HEADERS,
  SESSION_MEDIA_DENIED_HEADERS,
} from '../src/media-detection/session-media/request-header-policy';
import {
  stripRequestContextSecrets,
  requestContextHasSecretHeaders,
} from '../src/media-detection/session-media/strip-secrets';
import {
  evidenceImpliesSessionBound,
  shouldAttemptPublicFirst,
} from '../src/media-detection/session-media/session-bound-evidence';
import type { MediaRequestContext } from '../src/downloads/types/request-context';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not contain: ${needle}`);
  }
}

function sampleCtx(
  overrides: Partial<MediaRequestContext> = {},
): MediaRequestContext {
  return {
    pageUrl: 'https://site.example/watch',
    referer: 'https://site.example/watch',
    userAgent: 'TestUA',
    cookiesRequired: false,
    hasCookies: false,
    headers: { Accept: '*/*', Referer: 'https://site.example/watch' },
    capturedAt: Date.now(),
    authMode: 'PUBLIC',
    ...overrides,
  };
}

console.log('Phase 6B — Session-Aware Media Access Verification\n');

async function main(): Promise<void> {
  await test('1–3. public-first decision for non-social media', () => {
    assert(
      shouldAttemptPublicFirst({ pageUrl: 'https://news.example/a', requiresCookies: false }) ===
        true,
      'public first',
    );
    assert(evidenceImpliesSessionBound({ pageUrl: 'https://news.example/a' }) === false, 'not social');
  });

  await test('social evidence skips unnecessary public-first', () => {
    assert(
      shouldAttemptPublicFirst({ pageUrl: 'https://www.tiktok.com/@u/video/1' }) === false,
      'tiktok session-bound',
    );
    assert(
      evidenceImpliesSessionBound({ requiresCookies: true }) === true,
      'requiresCookies evidence',
    );
  });

  await test('4–5. 401/403 are auth-like', () => {
    assert(classifyAuthLikeFailure({ status: 401 }) === 'http_401', '401');
    assert(classifyAuthLikeFailure({ status: 403 }) === 'http_403', '403');
    assert(isAuthLikeFailure({ rejectionReason: 'AUTH_RESPONSE' }) === true, 'AUTH_RESPONSE');
  });

  await test('6. 404 does not trigger session attempt', () => {
    assert(classifyAuthLikeFailure({ status: 404 }) === 'not_auth_like', '404');
    assert(
      isAuthLikeFailure({ rejectionReason: 'EXPIRED_SOURCE', status: 404 }) === false,
      'expired',
    );
  });

  await test('7. invalid container / NOT_MEDIA not auth-like', () => {
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'NOT_MEDIA' }) === 'not_auth_like',
      'not media',
    );
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'INIT_SEGMENT' }) === 'not_auth_like',
      'init',
    );
  });

  await test('8. login HTML classified auth-like', () => {
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'HTML_RESPONSE', signatureKind: 'html' }) ===
        'login_html',
      'html',
    );
  });

  await test('9–11. cookie target scoping — mediaUrl only in builder', () => {
    const builder = readSrc('src/media-detection/session-media/session-request-context.ts');
    mustInclude(
      builder,
      [
        'getSessionCookiesForUrl(mediaUrl)',
        'never copy page-host',
        'target-URL scoped only',
      ],
      'builder',
    );
    mustNotInclude(
      builder,
      ['getSessionCookiesForUrl(canonicalPage)', 'getSessionCookiesForUrl(pageUrl'],
      'no page cookie fetch',
    );
    const legacy = readSrc('src/media-detection/services/request-context.service.ts');
    mustInclude(legacy, ['buildSessionCookieMediaRequestContext', 'buildPublicMediaRequestContext'], 'delegates');
    assert(
      !legacy.includes('[canonicalPage, pageUrlRaw, input.mediaUrl]'),
      'old page-first cookie list removed',
    );
  });

  await test('12–15. referer/origin/UA/accept policies in builder', () => {
    const builder = readSrc('src/media-detection/session-media/session-request-context.ts');
    mustInclude(
      builder,
      [
        'headers.Referer',
        "Accept: '*/*'",
        'User-Agent',
        'includeOrigin',
        'readDesktopModeForRequestContext',
      ],
      'policies',
    );
    mustInclude(builder, ['allowAuthorization: false'], 'no auth header');
    // Tab desktopMode still flows via bound snapshot (not browser store barrel).
    const bind = readSrc('src/browser/stores/browserStore/index.ts');
    mustInclude(bind, ['tab.desktopMode', 'bindDesktopModeSnapshotReader'], 'desktop bind');
  });

  await test('16. Authorization not generically captured', () => {
    const filtered = filterSessionMediaHeaders({
      Authorization: 'Bearer SECRET',
      Cookie: 'a=1',
      Referer: 'https://site.example/',
    });
    assert(!filtered.Authorization, 'auth dropped');
    assert(filtered.Cookie === 'a=1', 'cookie allowed when present');
    assert(filtered.Referer?.startsWith('https://'), 'referer kept');
  });

  await test('AUTH_CONTEXT_UNAVAILABLE when bearer required but unavailable', () => {
    const access = resolveAccessClassAfterFailure({
      failure: { status: 401 },
      usedSession: false,
      sessionHadCookies: false,
    });
    assert(access === 'AUTH_CONTEXT_UNAVAILABLE', access);
    assert(
      classifyPostSessionFailure({ status: 401 }) === 'SESSION_EXPIRED',
      'post-session 401',
    );
  });

  await test('17–20. authenticated verify wiring in general source', () => {
    const general = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    mustInclude(
      general,
      [
        'maybeBuildSessionRetryContext',
        "authMode: media.requiresCookies ? undefined : 'PUBLIC'",
        'session_verify_success',
        'public_verify_success',
      ],
      'public-first wiring',
    );
  });

  await test('21–26. DRM/blob/DASH/segment policies preserved', () => {
    const general = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    mustInclude(general, ['DRM_UNSUPPORTED', 'DASH_UNSUPPORTED', 'BLOB_ONLY'], 'rejects');
    const hls = readSrc('src/media-detection/general-source/hls-evidence.ts');
    mustInclude(hls, ['isHlsDrmOrUnsupportedEncryption'], 'hls drm');
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'DRM_UNSUPPORTED' }) === 'not_auth_like',
      'drm not auth retry',
    );
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'SEGMENT_RESOURCE' }) === 'not_auth_like',
      'segment not auth',
    );
    assert(
      classifyAuthLikeFailure({ rejectionReason: 'BLOB_ONLY' }) === 'not_auth_like',
      'blob not auth',
    );
  });

  await test('27. signed URL preserved but redacted in diagnostics', () => {
    const identity = readSrc('src/media-detection/social-source/resource-identity.ts');
    mustInclude(identity, ['preserveExecutableUrl'], 'preserve');
    const diag = readSrc('src/media-detection/services/media-diagnostics.service.ts');
    mustInclude(diag, ['QueryPresent', 'hostname'], 'url redact');
  });

  await test('28–31. generation scope + tab close + account switch', () => {
    const general = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    mustInclude(general, ['isGeneralScopeCurrent', 'pageGeneration', 'navigationEpoch'], 'scope');
    const actions = readSrc('src/browser/stores/browserStore/actions.ts');
    mustInclude(actions, ['clearVerificationForTab', 'clearTab'], 'tab close');
    const session = readSrc('src/media-detection/social-source/verification-session.ts');
    mustInclude(session, ['stripRequestContextSecrets', 'clearVerificationForTab'], 'cache clear');
  });

  await test('32–34. no raw cookie/Auth persistence; secrets stripped from cache', () => {
    const ctx = sampleCtx({
      hasCookies: true,
      headers: {
        Accept: '*/*',
        Cookie: 'session=SECRET',
        Authorization: 'Bearer X',
        Referer: 'https://site.example/',
      },
      authMode: 'SESSION_COOKIE',
    });
    assert(requestContextHasSecretHeaders(ctx) === true, 'has secrets');
    const stripped = stripRequestContextSecrets(ctx);
    assert(stripped != null && stripped.hasCookies === false, 'flags cleared');
    assert(!stripped!.headers.Cookie, 'cookie gone');
    assert(!stripped!.headers.Authorization, 'auth gone');
    assert(stripped!.headers.Referer?.startsWith('https://'), 'referer kept');
    assert(
      Object.keys(stripSecretRequestHeaders({ Cookie: 'x', Accept: '*/*' })).includes('Accept'),
      'accept kept',
    );

    const pause = readSrc('src/downloads/engine/pause-state.ts');
    mustInclude(pause, ['sanitizePauseHeaders', "lower === 'cookie'"], 'pause sanitize');
  });

  await test('35–38. no polling / backend / FFmpeg / credential extraction', () => {
    const sessionDir = join(ROOT, 'src/media-detection/session-media');
    assert(existsSync(sessionDir), 'session-media module');
    for (const file of [
      'auth-failure.classifier.ts',
      'session-request-context.ts',
      'public-first-verify.ts',
      'request-header-policy.ts',
    ]) {
      const src = readSrc(`src/media-detection/session-media/${file}`);
      mustNotInclude(src, ['setInterval(', 'ffmpeg', 'supabase', 'firebase', 'document.cookie'], file);
    }
    assert(SESSION_MEDIA_ALLOWED_HEADERS.includes('cookie'), 'cookie allow');
    assert(SESSION_MEDIA_DENIED_HEADERS.includes('proxy-authorization'), 'deny proxy');
  });

  await test('header allowlist rejects tracking / websocket headers', () => {
    const out = filterSessionMediaHeaders({
      'X-Track': '1',
      'Sec-WebSocket-Key': 'abc',
      Origin: 'https://site.example',
      Accept: '*/*',
    });
    assert(!out['X-Track'], 'no track');
    assert(!out['Sec-WebSocket-Key'], 'no ws');
    assert(out.Origin === 'https://site.example', 'origin ok');
  });

  await test('MediaRequestContext carries authMode + scope fields', () => {
    const types = readSrc('src/downloads/types/request-context.ts');
    mustInclude(
      types,
      ['authMode?', 'tabId?', 'navigationEpoch?', 'pageGeneration?', 'mediaIdentity?', 'SESSION_COOKIE'],
      'types',
    );
  });

  await test('no Phase 6C worker auth refresh invented', () => {
    const session = readSrc('src/media-detection/session-media/session-request-context.ts');
    mustNotInclude(
      session,
      ['midTransfer', 'refreshAuthLoop', 'pause/resume auth'],
      'no 6C',
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
