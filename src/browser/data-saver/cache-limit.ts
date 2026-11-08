/**
 * B18 #192 — whether the WebView cache should be cleared at this start. Pure.
 *
 * Over the limit → clear. Chromium may keep some files (code cache, GPU cache) that clearing doesn't remove; the size
 * right after a clear is remembered as the "floor", and a later start clears only when the cache has grown past the
 * limit *and* past that floor by a tenth — so a cache that can't get under the limit isn't cleared on every start.
 */
export function shouldClearCache(sizeBytes: number, limitBytes: number, floorBytes: number): boolean {
  if (!(limitBytes > 0) || !Number.isFinite(sizeBytes) || sizeBytes <= limitBytes) return false;
  if (floorBytes > limitBytes && sizeBytes <= floorBytes * 1.1) return false;
  return true;
}
