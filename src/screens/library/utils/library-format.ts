import type { MediaLibraryItem } from '@/library';
import { libraryFormatLabel } from '@/library/format-label';
import {
  formatDownloadDate,
  formatDownloadFileSize,
  formatDurableResolution,
} from '@/screens/downloads/utils/download-format';

export function formatLibraryFileSize(fileSize: string): string | null {
  // Treat unknown / zero as absent — do not fabricate authoritative size UI.
  if (!fileSize || fileSize === '0') {
    return null;
  }
  return formatDownloadFileSize(fileSize);
}

export function formatLibraryDate(isoDate: string | null): string | null {
  return formatDownloadDate(isoDate);
}

export function formatLibraryResolution(
  resolution: string | null,
): string | null {
  return formatDurableResolution(resolution);
}

function formatLibraryContainer(mimeType: string | null): string | null {
  return libraryFormatLabel(mimeType);
}

export function buildLibraryMetaLine(item: MediaLibraryItem): string {
  const parts: string[] = [];
  const format = formatLibraryContainer(item.mimeType);
  if (format) {
    parts.push(format);
  }
  const size = formatLibraryFileSize(item.fileSize);
  if (size) {
    parts.push(size);
  }
  if (item.quality) {
    parts.push(item.quality);
  }
  const resolution = formatLibraryResolution(item.resolution);
  if (resolution && resolution.replace(/\s+/g, '') !== item.quality) {
    parts.push(resolution);
  }
  const date = formatLibraryDate(item.downloadedAt);
  if (date) {
    parts.push(date);
  }
  return parts.join(' · ');
}

export function buildLibraryGridMeta(item: MediaLibraryItem): string {
  const parts: string[] = [];
  const format = formatLibraryContainer(item.mimeType);
  if (format) {
    parts.push(format);
  }
  if (item.quality) {
    parts.push(item.quality);
  }
  const size = formatLibraryFileSize(item.fileSize);
  if (size) {
    parts.push(size);
  }
  return parts.join(' · ');
}
