/**
 * Orders a tab's items for the download sheet: the item for the page the user is on, then the one playing or
 * visible, then items with audio, then resolution, bitrate and recency.
 */
import type { TabState, TrackedItem } from './tab-state.ts';
import type { PlayerHint } from './types.ts';
import { groupingKey, pageIdentity, urlMentions } from './url.ts';

/** Range or segment requests newer than this mean the item's media is being played right now. */
export const ACTIVE_WINDOW_MS = 10_000;

const VISIBLE_RATIO = 0.5;
const DURATION_TOLERANCE_SEC = 0.25;
// Shorter asset ids are too likely to appear in unrelated URL segments.
const MIN_ASSET_ID_LENGTH = 4;

export function rankTabItems(tab: TabState, now: number): TrackedItem[] {
  const players = Object.values(tab.players)
    .flat()
    .filter((player) => player.playing || player.visibleRatio >= VISIBLE_RATIO);
  const currentPage = pageIdentity(tab.currentUrl);
  return tab.order
    .map((key) => {
      const item = tab.items[key];
      const score = [
        matchesPage(item, tab.currentUrl, currentPage) ? 1 : 0,
        playbackScore(item, players, now),
        audioScore(item),
        Math.max(0, ...item.sources.map((source) => ('height' in source ? (source.height ?? 0) : 0))),
        Math.max(0, ...item.sources.map((source) => ('bitrate' in source ? (source.bitrate ?? 0) : 0))),
        item.lastSeenAt,
      ];
      return { item, score };
    })
    .sort((a, b) => compareDescending(a.score, b.score))
    .map(({ item }) => item);
}

function matchesPage(item: TrackedItem, currentUrl: string, currentPage: string | null): boolean {
  if (currentPage === null) {
    return false;
  }
  if (item.contentUrl !== null && pageIdentity(item.contentUrl) === currentPage) {
    return true;
  }
  if (item.key.startsWith('url:')) {
    return item.key === `url:${groupingKey(currentUrl)}`;
  }
  const assetId = item.key.slice(item.key.indexOf(':') + 1);
  return assetId.length >= MIN_ASSET_ID_LENGTH && urlMentions(currentUrl, assetId);
}

/** 2 = playing (player hint or live network activity), 1 = visible, 0 = neither. */
function playbackScore(item: TrackedItem, players: readonly PlayerHint[], now: number): number {
  if (item.activeAt !== null && now - item.activeAt <= ACTIVE_WINDOW_MS) {
    return 2;
  }
  let score = 0;
  for (const player of players) {
    if (playerShows(player, item)) {
      score = Math.max(score, player.playing ? 2 : 1);
    }
  }
  return score;
}

function playerShows(player: PlayerHint, item: TrackedItem): boolean {
  const srcKey = player.src ? groupingKey(player.src) : null;
  if (srcKey !== null && item.sources.some((source) => groupingKey(source.url) === srcKey)) {
    return true;
  }
  if (player.poster && item.thumbnailUrl && groupingKey(player.poster) === groupingKey(item.thumbnailUrl)) {
    return true;
  }
  // Blob (MSE) players expose no URL; a matching duration is the best link to the item they play.
  return (
    player.isBlob &&
    player.durationSec !== undefined &&
    item.durationSec !== null &&
    Math.abs(player.durationSec - item.durationSec) <= DURATION_TOLERANCE_SEC
  );
}

/** 2 = has audio (known, separate audio file, or a manifest), 1 = unknown, 0 = known silent. */
function audioScore(item: TrackedItem): number {
  let score = 0;
  for (const source of item.sources) {
    if (source.kind !== 'progressive' || source.hasAudio === true || source.audioUrl !== undefined) {
      return 2;
    }
    if (source.hasAudio == null) {
      score = 1;
    }
  }
  return score;
}

function compareDescending(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return b[index] - a[index];
    }
  }
  return 0;
}
