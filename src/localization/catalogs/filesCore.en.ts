/**
 * Faran's File Manager packages (F12–F17): the low space alert (F14), SD card and the folders added through Android's
 * folder picker (F15), opening files from other apps (F16). Hamza's File Manager screens use their own catalog
 * (`files.en.ts`). `filesCore.ur.ts` mirrors it.
 */
export const filesCoreEn = {
  // F14 · #855 Low space alert
  lowSpaceChannel: 'Low storage',
  lowSpaceTitle: 'Phone storage is low',
  lowSpaceBody: '{free} left. Open VidoraX → Files → Storage to free space.',
  // F16 · #873 Default app, #947 File associations
  openWithTitle: 'Open videos with VidoraX',
  openWithSub: 'Android lets you pick the default app: App info → Open by default',
  openWithHint: 'Opens VidoraX’s app info in Android settings',
  // F15 · "SD card" and "Folders I added" (designs 26 and 27)
  sdCardChip: 'SD card',
  foldersChip: 'Folders I added',
  foldersTitle: 'Folders VidoraX can open',
  foldersSub: 'Only the folders you pick. VidoraX never changes their files.',
  sdCardTitle: 'SD card',
  sdCardSub: 'Folders you picked on the SD card',
  storageAccessRow: 'Folders VidoraX can open',
  storageAccessRowSub: '{count} folders',
  storageAccessRowSubOne: '1 folder',
  storageAccessSection: 'Storage access',
  onPhone: 'Phone storage',
  onSdCard: 'SD card',
  accessLost: 'Access was removed. Tap to pick it again.',
  folderRowHint: 'Opens the folder. Long press to remove it.',
  noFolders: 'No folders yet',
  noSdFolders: 'No SD card folders yet',
  noFoldersHint: 'Pick a folder and VidoraX can play the videos and music in it.',
  addFolder: 'Add folder',
  addFromSd: 'Add a folder from the SD card',
  removeTitle: 'Remove “{name}”?',
  removeMessage: 'VidoraX stops opening this folder. Nothing in it is deleted.',
  remove: 'Remove',
  folder: 'Folder',
  itemCount: '{count} items',
  itemCountOne: '1 item',
  emptyFolder: 'This folder is empty.',
  cantRead: 'VidoraX can’t read this folder any more. Pick it again from Folders VidoraX can open.',
  importA11y: 'Copy this folder’s videos into VidoraX',
  importTitle: 'Import to VidoraX',
  importDone: '{imported} copied. {duplicates} were already saved.',
  importFailed: 'Couldn’t import this folder.',
  // F17 · the backup's File Manager part (restore preview)
  previewFiles: 'File Manager: {count} folders, tags and notes of {items} files, its settings',
} as const;
