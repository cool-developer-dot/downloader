/**
 * The video card of screen 19: the full width between the 16 dp gutters, 169 dp tall on the design's 360 dp screen
 * (326 × 169). A video taller than that shape gets a taller card — up to a square — so a 16:9 or portrait video is not
 * shrunk behind black bars; a wider one keeps the design's height.
 */

export const CARD_DESIGN_RATIO = 169 / 326;
const CARD_MAX_RATIO = 1;

export function playerCardSize(
  availableWidth: number,
  picture: { width: number; height: number } | null | undefined,
): { width: number; height: number } {
  const width = Math.max(0, Math.floor(availableWidth));
  const designHeight = width * CARD_DESIGN_RATIO;
  let height = designHeight;
  if (picture && picture.width > 0 && picture.height > 0) {
    const fitted = width * (picture.height / picture.width);
    height = Math.min(Math.max(fitted, designHeight), width * CARD_MAX_RATIO);
  }
  return { width, height: Math.round(height) };
}
