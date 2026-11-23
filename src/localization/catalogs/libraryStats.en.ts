/**
 * P9 Library stats & bookmarks (#708 Play Count, #626 Most Played, #711 Duration Filter, #628 Include/Exclude
 * Folders, #726 Quick Delete, #687 Disable History, #705 Video Bookmarks). `libraryStats.ur.ts` mirrors it.
 */
export const libraryStatsEn = {
  // #626 Most played (a Library sort)
  sortMostPlayed: 'Most played',
  // #711 Duration filter
  durationTitle: 'Length',
  durationSubtitle: 'Show short or long videos. A video whose length isn’t known yet shows only under Any length.',
  durationAny: 'Any length',
  durationUnder5: 'Under 5 min',
  duration5to20: '5 to 20 min',
  duration20to60: '20 to 60 min',
  durationOver60: '60 min or more',
  lengthCaption: 'Length: {label}',
  // #628 Include / exclude folders
  foldersTitle: 'Include / exclude folders',
  foldersSubtitle: 'Hidden folders don’t show in the Library, Most played or search. No video is deleted or moved.',
  foldersUnfiled: 'Unfiled / Downloads',
  folderShown: 'Shown in the Library',
  folderHidden: 'Hidden from the Library',
  foldersHiddenCount: 'Include / exclude folders ({count} hidden)',
  // #708 Play count
  playCountLabel: 'Played',
  playCountNone: 'Not yet',
  playCountOnce: 'Once',
  playCountTimes: '{count} times',
  lastCountedLabel: 'Last played',
  playedOnce: 'Played once',
  playedTimes: 'Played {count} times',
  // #687 Disable history
  disableHistory: 'Don’t save watch history',
  disableHistoryHint: 'Nothing new goes into Watch history, Continue watching, resume points or play counts. What’s already there stays until you clear it.',
  historyPausedOn: 'Watch history is off',
  historyPausedOff: 'Watch history is on',
  // #705 Video bookmarks
  addBookmark: 'Add bookmark',
  addBookmarkHere: 'Add a bookmark at {time}',
  bookmarks: 'Bookmarks',
  bookmarksSubtitle: 'Tap a bookmark to jump to it',
  bookmarksEmpty: 'No bookmarks yet. Add one to mark a moment in this video.',
  bookmarkNewTitle: 'New bookmark',
  bookmarkRenameTitle: 'Rename bookmark',
  bookmarkName: 'Name (optional)',
  bookmarkAt: 'At {time}',
  bookmarkSave: 'Save',
  bookmarkAdded: 'Bookmark added at {time}',
  bookmarkRenameA11y: 'Rename {name}',
  bookmarkDeleteA11y: 'Delete {name}',
  bookmarkJumpHint: 'Jumps to this moment',
  bookmarkDeleteTitle: 'Delete this bookmark?',
  bookmarkDeleteMessage: '“{name}” is removed from this video’s bookmarks. The video isn’t changed.',
  bookmarkDeleteConfirm: 'Delete',
  bookmarkDeleted: 'Bookmark deleted',
  bookmarkJumped: 'Jumped to {time}',
  bookmarksFull: 'This video already has {max} bookmarks',
  bookmarkFailed: 'Couldn’t save the bookmark',
  // #726 Quick delete
  quickDelete: 'Delete video',
  quickDeleteHint: 'Deletes it from VidoraX, then plays the next video',
  quickDeleteTitle: 'Delete “{name}” from VidoraX?',
  quickDeleteMessageNext: 'Copies saved outside VidoraX are not deleted. The next video in the queue plays.',
  quickDeleteMessageClose: 'Copies saved outside VidoraX are not deleted. There is no next video, so the Player closes.',
  quickDeleteConfirm: 'Delete',
  quickDeleteDone: 'Video deleted',
} as const;
