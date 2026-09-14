/**
 * Map real HLS variants to quality descriptors.
 * Display labels are derived from playlist evidence only — never invented ladders.
 */

import type { HlsVariant } from './playlist';

export type HlsVariantQuality = {
  url: string;
  bandwidth: number | null;
  averageBandwidth: number | null;
  resolution: string | null;
  codecs: string | null;
  frameRate: number | null;
  /** "{height}p" when height is known; otherwise null. */
  label: string | null;
};

export function describeHlsVariant(variant: HlsVariant): HlsVariantQuality {
  const height =
    typeof variant.height === 'number' &&
    Number.isFinite(variant.height) &&
    variant.height > 0
      ? Math.trunc(variant.height)
      : null;

  return {
    url: variant.url,
    bandwidth: variant.bandwidth,
    averageBandwidth: variant.averageBandwidth,
    resolution: variant.resolution,
    codecs: variant.codecs,
    frameRate: variant.frameRate,
    label: height != null ? `${height}p` : null,
  };
}

export function describeHlsVariants(variants: HlsVariant[]): HlsVariantQuality[] {
  return variants.map(describeHlsVariant);
}
