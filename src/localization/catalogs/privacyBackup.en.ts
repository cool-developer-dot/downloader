/**
 * P11 Privacy & backup (#686 Private Folder, #689 Block Screen Capture, #700 Backup / Restore). The Player's
 * "Move to Private" row and its dialogs reuse `privateVault.*`. `privacyBackup.ur.ts` mirrors it.
 */
export const privacyBackupEn = {
  // #689 Block Screen Capture (Settings → Privacy)
  blockCapture: 'Block screenshots in Private',
  blockCaptureHint:
    'No screenshots or screen recording while Private or one of its videos is open. Other screens and videos aren’t affected.',
  // #686 Move out of Private
  moveOut: 'Move out of Private',
  moveOutTitle: 'Move out of Private?',
  moveOutMessage:
    '“{title}” will be saved to your Gallery (Movies/VidoraX) as a normal, unencrypted video that other apps can see, then removed from Private. VidoraX shows it with the videos on this phone. Its play count and bookmarks don’t come back.',
  moveOutConfirm: 'Move out',
  movingOut: 'Moving out… {percent}',
  movingOutPlain: 'Moving out…',
  movedOut: 'Moved to your Gallery',
  moveOutFailed: 'Couldn’t move this video out. It’s still in Private.',
  moveOutKept: 'It was saved to your Gallery, but couldn’t be removed from Private. You can delete it here.',
  // #700 Backup / Restore (Settings → Backup & reset)
  backupAll: 'Back up all data',
  backupAllHint:
    'Settings, Player choices, playlists, video bookmarks and play counts in one file. No videos, nothing from Private or App Lock.',
  restoreAll: 'Restore from backup',
  restoreAllHint: 'Shows what the file holds first. Then merge it or replace.',
  backupShareTitle: 'VidoraX backup',
  backupSaved: 'Backup saved',
  backupShared: 'Backup shared',
  backupFailed: 'Couldn’t make the backup.',
  restoreNewer: 'This backup was made by a newer version of VidoraX. Update VidoraX to restore it.',
  restoreBrowserBackup: 'This is a browser backup. Restore it in the browser’s settings, under Profiles.',
  restoreTooLarge: 'This file is too large to be a VidoraX backup.',
  restoreNotBackup: 'This file isn’t a VidoraX backup.',
  restoreFailed: 'Couldn’t restore the backup.',
  restored: 'Backup restored',
  previewTitle: 'Restore this backup?',
  previewMade: 'Made on {date}',
  previewSettingsOnly: 'An older settings backup: it holds settings only.',
  previewEmpty: 'There is nothing to restore in this file.',
  previewNever: 'Never in a backup: videos, Private, App Lock (PIN, recovery code, fingerprint).',
  previewSettings: 'Settings: {count}',
  previewPreferences: 'Player and Library choices: {count}',
  previewLoops: 'Saved A-B loops: {count}',
  previewHiddenFolders: 'Hidden folders: {count}',
  previewPlaylists: 'Playlists: {count} ({videos} videos)',
  previewBookmarks: 'Video bookmarks: {count}',
  previewPlayCounts: 'Play counts: {count} videos',
  merge: 'Merge',
  mergeHint: 'Merge adds what’s in the file. Nothing on this phone is deleted.',
  replace: 'Replace',
  replaceHint:
    'Replace makes this phone match the file for everything the file holds: other playlists, bookmarks and play counts are deleted, and other settings go back to their defaults.',
  confirmMergeTitle: 'Merge this backup?',
  confirmMergeMessage: 'What’s in the file is added to VidoraX, and its settings are applied. Nothing is deleted.',
  confirmReplaceTitle: 'Replace with this backup?',
  confirmReplaceMessage:
    'For everything the file holds, what’s on this phone is replaced: playlists, video bookmarks and play counts that aren’t in the file are deleted, and settings that aren’t in it go back to their defaults. This can’t be undone. App Lock and Private aren’t touched.',
} as const;
