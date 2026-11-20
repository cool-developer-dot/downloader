/**
 * P8 #461 Malware Warning: a file whose contents do not match its name (an app or program called `.mp4`), a double
 * extension (`clip.mp4.exe`), and programs inside an archive. `fileSafety.ur.ts` mirrors these keys.
 */
export const fileSafetyEn = {
  disguisedDownloadTitle: 'This file is disguised',
  disguisedDownloadMessage:
    '"{fileName}" is named like a video or a document, but the site sends it as an app or a program. It may be harmful. Download it only if you trust the site.',
  doubleExtensionMessage:
    '"{fileName}" hides a program behind a second extension. It may be harmful. Continue only if you trust where it came from.',
  disguisedTitle: "This file isn't what its name says",
  disguisedMessage: '"{fileName}" is named like a video, but it is really {kind}. It may be harmful.',
  disguisedMessageUnknown: '"{fileName}" is named like a video, but it is something else. It may be harmful.',
  programTitle: 'This file is a program',
  programMessage: '"{fileName}" can install an app or run a program. Continue only if you trust where it came from.',
  disguisedSourceMessage: 'A "video" from {host} is really {kind}. VidoraX did not download it.',
  kindApk: 'an Android app (APK)',
  kindExe: 'a Windows program',
  kindScript: 'a script',
  kindProgram: 'a program',
  kindArchive: 'an archive',
  openAnyway: 'Open anyway',
  shareAnyway: 'Share anyway',
  extractAnyway: 'Extract anyway',
  saveAnyway: 'Save anyway',
  saveRefused: 'Not saved: this file is not a video and may be harmful.',
  archiveProgramsTitle: 'Programs in this archive',
  archiveProgramsMessage:
    'This archive also holds programs ({names}). VidoraX never extracts them — only videos and subtitles.',
  archiveDisguisedMessage: 'Left out because they are not videos: {names}. They are named like videos but are programs or archives.',
};
