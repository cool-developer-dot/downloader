/**
 * Files F7 · #778 Folder icon color, #977 Color tags: the 8 colours a folder icon or a tag can take (the design kit's
 * swatches, `dsSwatchColors`). Pure. Stored by id, so a palette change never breaks a saved choice.
 */

import { dsSwatchColors } from '@/design/tokens';

export const SWATCH_IDS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type SwatchId = (typeof SWATCH_IDS)[number];

export function isSwatchId(value: unknown): value is SwatchId {
  return typeof value === 'string' && (SWATCH_IDS as readonly string[]).includes(value);
}

export function swatchColor(id: SwatchId): string {
  return dsSwatchColors[id];
}
