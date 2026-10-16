import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

/**
 * The native vault (library/PrivateVault.kt) behind Private (#459, #463). Null on builds without it: then no Private
 * entry or "Move to Private" action is shown at all.
 */
export type VaultPort = {
  moveToVault(id: string): Promise<unknown>;
  listVault(): Promise<unknown>;
  getVaultThumbnail(vaultId: string): Promise<string | null>;
  openVaultItem(vaultId: string): Promise<string>;
  clearVaultPlayback(): Promise<void>;
  cleanUpVault(): Promise<void>;
  deleteVaultItem(vaultId: string): Promise<void>;
  exportVaultItemToGallery(vaultId: string): Promise<string>;
  exportVaultItemToFolder(vaultId: string, treeUri: string): Promise<string>;
  getVaultProgress(key: string): { bytesDone: number; totalBytes: number } | null;
};

const METHODS: readonly (keyof VaultPort)[] = [
  'moveToVault',
  'listVault',
  'getVaultThumbnail',
  'openVaultItem',
  'clearVaultPlayback',
  'cleanUpVault',
  'deleteVaultItem',
  'exportVaultItemToGallery',
  'exportVaultItemToFolder',
  'getVaultProgress',
];

let override: VaultPort | null | undefined;

export function getVaultPort(): VaultPort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<Record<keyof VaultPort, unknown>>;
  return METHODS.every((name) => typeof media[name] === 'function') ? (media as unknown as VaultPort) : null;
}

/** `undefined` restores the real module. */
export function setVaultPortForTests(port: VaultPort | null | undefined): void {
  override = port;
}

/** Deletes any decrypted playback file. Never rejects. */
export function clearVaultPlayback(): void {
  void getVaultPort()
    ?.clearVaultPlayback()
    .catch(() => undefined);
}

/**
 * At start: playback files and half-written vault files an earlier run left behind (a crash, a kill while the
 * player was open) are deleted. Never rejects; a build without the vault does nothing.
 */
export function cleanUpPrivateVault(): void {
  void getVaultPort()
    ?.cleanUpVault()
    .catch(() => undefined);
}

/**
 * Opens the Android folder picker for "Export to folder". expo-file-system persists the folder's grant when it is
 * picked. Resolves with the folder's tree URI, or null when the user backed out.
 */
export async function pickExportFolder(): Promise<string | null> {
  try {
    const { Directory } = await import('expo-file-system');
    const directory = await Directory.pickDirectoryAsync();
    // expo-file-system adds a trailing slash to a directory's URI; the grant is held for the URI without it.
    const uri = typeof directory?.uri === 'string' ? directory.uri.replace(/\/+$/, '') : '';
    return uri.startsWith('content://') ? uri : null;
  } catch {
    return null;
  }
}
