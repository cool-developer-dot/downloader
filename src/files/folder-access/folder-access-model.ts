/**
 * F15, pure: the folders the user added through Android's folder picker ("Folders I added", and "SD card" for those
 * on a removable card). Only these folders are ever listed — never the whole phone or the whole card.
 */
export type AddedFolder = { treeUri: string; label: string; addedAt: number };

const EXTERNAL_STORAGE = 'com.android.externalstorage.documents';

/** The tree's document id ("primary:Movies", "1A2B-3C4D:DCIM"), decoded; null for a URI that is not a tree. */
export function treeDocumentIdOf(treeUri: string): string | null {
  const match = /\/tree\/([^/?#]+)/.exec(treeUri);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** "primary" for the phone's own storage, the card's id ("1A2B-3C4D") for an SD card or USB drive, else null. */
export function volumeIdOf(treeUri: string): string | null {
  if (!treeUri.startsWith(`content://${EXTERNAL_STORAGE}/`)) {
    return null;
  }
  const docId = treeDocumentIdOf(treeUri);
  const colon = docId?.indexOf(':') ?? -1;
  return docId && colon > 0 ? docId.slice(0, colon) : null;
}

/** True for a folder on removable storage (an SD card or USB drive), never for the phone's own storage. */
export function isRemovableTree(treeUri: string): boolean {
  const volume = volumeIdOf(treeUri);
  return volume != null && volume !== 'primary' && volume !== 'home';
}

/** A readable name: the folder's last path part ("Movies"), or the card id for a card's root. */
export function labelOfTree(treeUri: string): string {
  const docId = treeDocumentIdOf(treeUri) ?? treeUri;
  const path = docId.includes(':') ? docId.slice(docId.indexOf(':') + 1) : docId;
  const last = path.split('/').filter(Boolean).pop();
  return last || docId.split(':')[0] || treeUri;
}

export function normalizeAddedFolders(raw: unknown): AddedFolder[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: AddedFolder[] = [];
  for (const value of raw) {
    const entry = value as Partial<AddedFolder> | null;
    if (!entry || typeof entry.treeUri !== 'string' || !entry.treeUri.startsWith('content://') || seen.has(entry.treeUri)) {
      continue;
    }
    seen.add(entry.treeUri);
    out.push({
      treeUri: entry.treeUri,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : labelOfTree(entry.treeUri),
      addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : 0,
    });
  }
  return out;
}

export type AddedFolderView = AddedFolder & { removable: boolean; accessible: boolean };

/** The folders to show: `removable` for the SD card chip, `accessible` false when Android took the grant back. */
export function viewAddedFolders(added: readonly AddedFolder[], grantedTrees: readonly string[] | null): AddedFolderView[] {
  const granted = grantedTrees ? new Set(grantedTrees.map((uri) => uri.replace(/\/+$/, ''))) : null;
  return [...added]
    .sort((a, b) => a.label.localeCompare(b.label) || a.treeUri.localeCompare(b.treeUri))
    .map((folder) => ({
      ...folder,
      removable: isRemovableTree(folder.treeUri),
      accessible: granted ? granted.has(folder.treeUri.replace(/\/+$/, '')) : true,
    }));
}

/** A short stable id for a picked file (the Player's media id must not hold "/" or ":"). */
export function pickedFileId(uri: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < uri.length; i += 1) {
    const c = uri.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `saf-${h1.toString(16)}${h2.toString(16)}`;
}
