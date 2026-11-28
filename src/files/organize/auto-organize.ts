/**
 * Files F7 · #937 Auto organize: the Files tab's ⋮ → Organize now. Pure: the plan only; the screen shows it first
 * ("12 files into 3 folders") and then carries it out.
 *
 * Only files in no folder are touched — a file the user already filed stays where it is. They go into a folder per
 * type, per site or per month. A folder that already exists with that name (ignoring case) is reused, never doubled.
 * The download rules (save location by type and by site) are not changed.
 */

import type { FileType } from '@/files/ui/file-types';
import { isSystemDownloadId } from '@/files/ui/library-files';

export const ORGANIZE_BY = ['type', 'site', 'month'] as const;
export type OrganizeBy = (typeof ORGANIZE_BY)[number];

export type OrganizeFile = { id: string; type: FileType; folderId: string | null; date: string | null; site?: string | null };

export type OrganizeGroup = {
  /** The folder's name. */
  name: string;
  /** The existing folder of that name, or null when it is made. */
  folderId: string | null;
  fileIds: string[];
};

export type OrganizePlan = { groups: OrganizeGroup[]; fileCount: number; folderCount: number; newFolderCount: number };

export type OrganizeLabels = {
  /** The folder name of a type ("Videos"…). */
  type: (type: FileType) => string;
  /** The folder name of a month ("November 2026"), from an ISO date. */
  month: (iso: string) => string;
  /** The folder for files of no known site or date. */
  other: string;
};

function keyOf(file: OrganizeFile, by: OrganizeBy, labels: OrganizeLabels): string {
  switch (by) {
    case 'type':
      return labels.type(file.type);
    case 'site':
      return file.site?.trim() || labels.other;
    case 'month':
      return file.date && Number.isFinite(Date.parse(file.date)) ? labels.month(file.date) : labels.other;
    default:
      return labels.other;
  }
}

/** The plan for the unfiled files of `files`. Groups keep the order their first file came in. */
export function planAutoOrganize(
  files: readonly OrganizeFile[],
  existingFolders: readonly { id: string; name: string }[],
  by: OrganizeBy,
  labels: OrganizeLabels,
): OrganizePlan {
  const byName = new Map(existingFolders.map((folder) => [folder.name.trim().toLocaleLowerCase(), folder] as const));
  const groups = new Map<string, OrganizeGroup>();
  for (const file of files) {
    // A file the browser handed to Android lives in Android's Downloads: it can't go into a VidoraX folder.
    if (file.folderId || isSystemDownloadId(file.id)) {
      continue;
    }
    const name = keyOf(file, by, labels);
    const key = name.toLocaleLowerCase();
    let group = groups.get(key);
    if (!group) {
      const existing = byName.get(key);
      group = { name: existing?.name ?? name, folderId: existing?.id ?? null, fileIds: [] };
      groups.set(key, group);
    }
    group.fileIds.push(file.id);
  }
  const list = [...groups.values()];
  return {
    groups: list,
    fileCount: list.reduce((sum, group) => sum + group.fileIds.length, 0),
    folderCount: list.length,
    newFolderCount: list.filter((group) => group.folderId === null).length,
  };
}

/** "example.com" from a page address; null when there is none. */
export function siteOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}
