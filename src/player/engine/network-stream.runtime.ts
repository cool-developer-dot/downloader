/**
 * P14 #663: opens a typed or pasted link in the Player. The engine's probe classifies it first (HLS, DASH or a file;
 * protected and YouTube links refused); the stream then plays like an online stream from the Browser (F17): an
 * in-memory `stream:` id, no library row, no history.
 */

import { getVidoraMedia, isVidoraMediaAvailable, type ProbeResult } from '@modules/vidorax-media';

import { openPlayer } from '@/navigation';

import { rememberRemoteStream, streamTitle } from '../remote-stream';
import { planNetworkStream, type NetworkStreamPlan } from './network-stream';

/** A slow server must not hold the screen: after this the link plays on the path's guess. */
const PROBE_TIMEOUT_MS = 15_000;

async function probeLink(url: string): Promise<ProbeResult | null> {
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
  });
  try {
    const engine = getVidoraMedia();
    return await Promise.race([engine.probe({ url, request: { useCookies: false } }), timeout]);
  } catch {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Checks the link and, when it can play, opens the Player on it. */
export async function openNetworkStream(url: string): Promise<NetworkStreamPlan> {
  const plan = planNetworkStream(url, await probeLink(url));
  if (!plan.ok) {
    return plan;
  }
  const mediaId = rememberRemoteStream({
    uri: plan.url,
    headers: {},
    contentType: plan.contentType,
    title: streamTitle({ offerTitle: null, pageUrl: null, mediaUrl: plan.url }),
    thumbnailUrl: null,
  });
  openPlayer(mediaId);
  return plan;
}
