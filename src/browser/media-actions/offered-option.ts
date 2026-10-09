import { selectDefaultQualityOption } from '@/downloads/quality';
import type { DownloadQualityOption } from '@/downloads/quality/types';

/**
 * The option a single-tap download hands off: the variant the offer was published for (its URL — a DASH manifest's
 * representations share one, so the best of those), never a different source that ranks higher by quality.
 * Falls back to the best option only when the offer named none of them.
 */
export function pickOfferedQualityOption(
  options: DownloadQualityOption[],
  offeredUrl: string | null | undefined,
): DownloadQualityOption | null {
  const offered = offeredUrl
    ? options.filter((option) => option.downloadable && option.sourceUrl === offeredUrl)
    : [];
  return selectDefaultQualityOption(offered.length > 0 ? offered : options);
}
