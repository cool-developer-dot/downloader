/**
 * Files F1 · #753 Categories: the Files tab's six type tiles (Videos, Audio, Images, Docs, Archives, APKs), each with
 * its count for TalkBack ("Videos, 12 files"). Files of an unknown type have no tile. Pure.
 */

import type { DsIconName } from '@/design/DsIcon';
import { isFileType, type FileType } from '@/files/ui/file-types';
import type { TypeCounts } from '@/files/ui/files-index';
import type { TranslationKey } from '@/localization/types';

export type TileType = Exclude<FileType, 'other'>;

export type TypeTile = {
  type: TileType;
  icon: DsIconName;
  labelKey: TranslationKey;
  count: number;
};

const TILES: readonly Omit<TypeTile, 'count'>[] = [
  { type: 'video', icon: 'film', labelKey: 'filesTab.videos' },
  { type: 'audio', icon: 'music', labelKey: 'filesTab.audio' },
  { type: 'image', icon: 'image', labelKey: 'filesTab.images' },
  { type: 'doc', icon: 'file-text', labelKey: 'filesTab.docs' },
  { type: 'archive', icon: 'archive', labelKey: 'filesTab.archives' },
  { type: 'apk', icon: 'package', labelKey: 'filesTab.apks' },
];

export const TILE_TYPES: readonly TileType[] = TILES.map((tile) => tile.type);

/** The six tiles in the design's order, with their counts (0 when the type has none). */
export function buildTypeTiles(counts: Partial<TypeCounts> | null | undefined): TypeTile[] {
  return TILES.map((tile) => ({ ...tile, count: Math.max(0, counts?.[tile.type]?.count ?? 0) }));
}

export function isTileType(value: unknown): value is TileType {
  return isFileType(value) && value !== 'other';
}

/** The tile's label key for a type (the type list's title). */
export function tileLabelKey(type: TileType): TranslationKey {
  return TILES.find((tile) => tile.type === type)!.labelKey;
}

/** The TalkBack label's key and params: "Videos, 1 file" / "Videos, 12 files". */
export function tileA11y(tile: TypeTile, label: string): { key: TranslationKey; params: { label: string; count: number } } {
  return {
    key: tile.count === 1 ? 'fileManager.tileA11yOne' : 'fileManager.tileA11yOther',
    params: { label, count: tile.count },
  };
}
