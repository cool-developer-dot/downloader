/**
 * Pure variant ranking / dedupe — no network or RN deps.
 */

import { logSocialSource } from './social-source-diagnostics';
import { stableResourcePath } from './resource-identity';
import type { VerifiedSocialMediaVariant } from './types';

/** Same logical media, whatever the signed query looks like now. */
function isSameResource(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const keyA = stableResourcePath(a);
  const keyB = stableResourcePath(b);
  return keyA != null && keyA === keyB;
}

/**
 * Preferred variant: actionable combined A/V first, then quality, then deterministic id.
 *
 * `ownedResourceUrl` is the source the ownership pass already chose as the current main video. When it is
 * given, only that video's variants compete — otherwise a preroll ad or a second video on the page wins this
 * ranking purely by being larger, and the user is offered something they are not watching. Quality ranking
 * still decides between the renditions *of that video*, which is the case this ordering exists for.
 */
export function selectPreferredVariant(
  variants: VerifiedSocialMediaVariant[],
  ownedResourceUrl?: string | null,
): VerifiedSocialMediaVariant | null {
  const downloadable = variants.filter((v) => v.downloadable);
  const owned = ownedResourceUrl ? downloadable.filter((v) => isSameResource(v.executableUrl, ownedResourceUrl)) : [];
  const actionable = owned.length > 0 ? owned : downloadable;
  if (!actionable.length) {
    return null;
  }

  const ranked = [...actionable].sort((a, b) => {
    const aCombined =
      a.audioState === 'INCLUDED' ? 2 : a.audioState === 'UNKNOWN' ? 1 : 0;
    const bCombined =
      b.audioState === 'INCLUDED' ? 2 : b.audioState === 'UNKNOWN' ? 1 : 0;
    if (bCombined !== aCombined) {
      return bCombined - aCombined;
    }
    const aH = a.height ?? 0;
    const bH = b.height ?? 0;
    if (bH !== aH) {
      return bH - aH;
    }
    if ((b.bitrate ?? 0) !== (a.bitrate ?? 0)) return (b.bitrate ?? 0) - (a.bitrate ?? 0);
    return a.variantId.localeCompare(b.variantId);
  });

  return ranked[0] ?? null;
}

export function dedupeVariants(
  variants: VerifiedSocialMediaVariant[],
): VerifiedSocialMediaVariant[] {
  const byIdentity = new Map<string, VerifiedSocialMediaVariant>();
  for (const variant of variants) {
    const existing = byIdentity.get(variant.resourceIdentity);
    if (!existing) {
      byIdentity.set(variant.resourceIdentity, variant);
      continue;
    }
    if (variant.verifiedAt >= existing.verifiedAt) {
      byIdentity.set(variant.resourceIdentity, {
        ...variant,
        qualityLabel: variant.qualityLabel ?? existing.qualityLabel,
        sizeBytes: variant.sizeBytes ?? existing.sizeBytes,
        audioState:
          variant.audioState !== 'UNKNOWN'
            ? variant.audioState
            : existing.audioState,
      });
      logSocialSource('variant_replaced_with_fresher_source', {
        variantId: variant.variantId,
        contentIdentity: variant.resourceIdentity,
      });
    } else {
      logSocialSource('variant_deduped', { variantId: variant.variantId });
    }
  }
  return [...byIdentity.values()];
}
