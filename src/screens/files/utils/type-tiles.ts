/**
 * Files F1 · #753 Categories: the Files tab's six type tiles (Videos, Audio, Images, Docs, Archives, APKs), each with
 * its count for TalkBack ("Videos, 12 files"). Files of an unknown type have no tile. Pure.
 */

import type { DsIconName } from '@/design/DsIcon';
import { isFileType, type FileType } from '@/files/ui/file-types';
import type { FileEntry, TypeCounts } from '@/files/ui/files-index';
import type { TranslationKey } from '@/localization/types';
import { countByKind, itemsOfKind } from '@/screens/library/utils/library-kind';

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

/**
 * The six tiles in the design's order, with their counts (0 when the type has none). `videoCount`, when given, is the
 * Videos tile's count (`videoTileCount`, the Player tab's rule) in place of the video file type's.
 */
export function buildTypeTiles(counts: Partial<TypeCounts> | null | undefined, videoCount?: number): TypeTile[] {
  return TILES.map((tile) => ({
    ...tile,
    count: Math.max(0, tile.type === 'video' && videoCount !== undefined ? videoCount : (counts?.[tile.type]?.count ?? 0)),
  }));
}

/**
 * The Videos tile counts and lists exactly what the Player tab calls a video, through the Player tab's own functions
 * (`library-kind`), so its count always equals the Player tab's. That rule is "everything that isn't audio": an image,
 * a PDF or an unknown file is under Videos there, so it is here too (and it keeps its own tile).
 */
export function videoTileFiles<T extends Pick<FileEntry, 'mimeType' | 'fileName'>>(files: readonly T[]): T[] {
  return itemsOfKind(files, 'video');
}

export function videoTileCount(files: readonly Pick<FileEntry, 'mimeType' | 'fileName'>[]): number {
  return countByKind(files).videos;
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
