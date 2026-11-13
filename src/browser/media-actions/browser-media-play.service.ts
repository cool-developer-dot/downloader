/**
 * Play an offer online (F17): the chosen variant is confirmed still current exactly as a download would be (a newer
 * signed link the page produced is taken, an expired one is refused with "reload the page"), then handed to the
 * VidoraX player as a `stream:` media id. Nothing is downloaded, consumed or written to the library.
 */

import type { AnalyzedMediaSelection, DownloadQualityOption } from '@/downloads/quality/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { resolveFreshSourceForEnqueue } from '@/downloads/v2/source-refresh';
import { translate } from '@/localization';
import { getSessionCookiesForUrl } from '@/media-detection/adapters/cookie-bridge.adapter';
import { fetchManifestResource } from '@/media-detection/services/manifest.service';
import { runPreDownloadGate } from '@/media-detection/services/pre-download-gate.service';
import {
  buildRemoteStream,
  chooseHlsVariant,
  rememberRemoteStream,
  streamContentType,
  streamUnavailableReason,
  streamUsesCookies,
  type StreamUnavailableReason,
} from '@/player/remote-stream';

import { lookupLiveBrowserSource } from './browser-media-download.service';
import { refreshStaleDirectSource } from './direct-analysis.service';
import { lookupLiveMediaTitle } from './live-media-title';

export type PrepareStreamInput = {
  selection: AnalyzedMediaSelection;
  option: DownloadQualityOption;
  requestContext: MediaRequestContext | null;
  pageUrl: string | null;
};

export type PrepareStreamResult = { ok: true; mediaId: string } | { ok: false; message: string; reason: string };

/** Message for an offer that has no Play button (the UI hides it; a stale tap still gets a clear answer). */
export function streamUnavailableMessage(reason: StreamUnavailableReason): string {
  return translate(reason === 'split' ? 'downloads.playSplitUnavailable' : 'downloads.playUnavailable');
}

export async function prepareOfferStream(input: PrepareStreamInput): Promise<PrepareStreamResult> {
  const refused = streamUnavailableReason(input.option);
  if (refused) {
    return { ok: false, reason: refused, message: streamUnavailableMessage(refused) };
  }
  const kind = streamContentType(input.option);

  // A direct offer read from the page long ago: its signed link is read again from the page first.
  const direct = await refreshStaleDirectSource({
    pageUrl: input.pageUrl,
    sourceUrl: input.option.sourceUrl,
    audioSourceUrl: null,
    verifiedAtMs: input.requestContext?.capturedAt ?? null,
  });
  const sourceUrl = direct?.sourceUrl ?? input.option.sourceUrl;
  const sourceContext =
    direct && input.requestContext ? { ...input.requestContext, capturedAt: direct.verifiedAt } : input.requestContext;

  const fresh = await resolveFreshSourceForEnqueue(
    { sourceUrl, pageUrl: input.pageUrl, requestContext: sourceContext },
    {
      lookupLiveSource: lookupLiveBrowserSource,
      // A playlist or manifest is opened by the player itself, which reports a refused link; a single file is
      // checked here so an expired link is said before the player opens.
      gate:
        kind === 'progressive'
          ? (gateInput) =>
              runPreDownloadGate({
                sourceUrl: gateInput.sourceUrl,
                requestContext: gateInput.requestContext,
                verifiedAtMs: gateInput.verifiedAtMs,
                transport: 'PROGRESSIVE',
              })
          : async (gateInput) => ({
              ok: true,
              finalUrl: gateInput.sourceUrl,
              mimeType: kind === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml',
              contentLength: null,
              requestContext: gateInput.requestContext,
              transport: kind === 'hls' ? 'HLS' : 'DASH',
            }),
    },
  );
  if (!fresh.ok) {
    return {
      ok: false,
      reason: fresh.reason,
      message: fresh.reason === 'SOURCE_EXPIRED' ? translate('player.errors.STREAM_LINK_EXPIRED.message') : fresh.message,
    };
  }

  const liveTitle = lookupLiveMediaTitle({ pageUrl: input.pageUrl, sourceUrl: input.option.sourceUrl });
  const requestContext = fresh.requestContext ?? sourceContext;

  // An HLS offer that names the master plays the chosen variant, as its download would; a refused playlist is a link
  // that needs the page again — said here, before the player opens.
  let streamUrl = fresh.url;
  if (kind === 'hls') {
    const playlist = await fetchManifestResource(fresh.url, undefined, { referer: input.pageUrl, requestContext });
    if (playlist.ok) {
      const variant = chooseHlsVariant(playlist.text, playlist.finalUrl ?? fresh.url, {
        height: input.option.height,
        bitrate: input.option.bitrate,
      });
      streamUrl = variant.url ?? playlist.finalUrl ?? fresh.url;
    } else if (playlist.status === 401 || playlist.status === 403 || playlist.status === 404 || playlist.status === 410) {
      return { ok: false, reason: 'SOURCE_EXPIRED', message: translate('player.errors.STREAM_LINK_EXPIRED.message') };
    }
  }

  // The engine reads the WebView's cookies for each request itself; the player is given them for the stream's URL.
  const cookieHeader = streamUsesCookies(requestContext) ? await getSessionCookiesForUrl(streamUrl) : null;
  const built = buildRemoteStream({
    option: input.option,
    sourceUrl: streamUrl,
    requestContext,
    cookieHeader,
    // The name the live page gives this media first, then the offer's — the order a download uses (never the tab's
    // own title, which a direct file link can carry over from the previous page).
    offerTitle: liveTitle?.trim() || input.selection.title?.trim() || null,
    pageUrl: input.pageUrl,
    thumbnailUrl: input.selection.thumbnailUrl,
  });
  if (!built.ok) {
    return { ok: false, reason: built.reason, message: streamUnavailableMessage(built.reason) };
  }
  return { ok: true, mediaId: rememberRemoteStream(built.stream) };
}
