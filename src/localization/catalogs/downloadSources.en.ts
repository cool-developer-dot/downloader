/** P2 Sources — FTP links (#304), mirrors (#347) and Wi-Fi + mobile data together (#446). */
export const downloadSourcesEn = {
  // #446 Download Settings → Performance
  multiNetwork: 'Experimental: use Wi-Fi and mobile data together',
  multiNetworkHint:
    'On Wi-Fi, large downloads also fetch some parts over mobile data for more speed. This uses your mobile data, and it counts toward your data limit.',
  multiNetworkWifiOnly: 'Turn off “Wi-Fi only” to use this',
  // #304 FTP links
  ftpChecking: 'Checking the FTP file…',
  ftpStarted: 'Downloading {title}',
  ftpAlreadyDownloading: 'This file is already downloading',
  ftpAlreadyDownloaded: 'This file is already downloaded',
  ftpInvalid: 'This FTP link does not point to a file',
  ftpPrivate: 'Links to private network addresses are not allowed',
  ftpUnavailable: 'FTP downloads need a newer version of the app',
  ftpNotVideo: 'This file is not a video',
  ftpProtected: 'This video is protected',
  ftpLive: 'This is a live stream, not a file',
  ftpSignIn: 'The FTP server refused the user name or password',
  ftpNotFound: 'The file was not found on the FTP server',
  ftpNetwork: 'Could not reach the FTP server',
  ftpServer: 'The FTP server could not send this file',
  ftpOldAndroid: 'FTP downloads need Android 8 or later',
  // #347 Download details → Mirrors
  mirrorsTitle: 'Mirrors',
  mirrorsHint:
    'Other links to the same file. Each one is checked first (same size and first bytes), then parts are downloaded from all of them.',
  mirrorAdd: 'Add mirror',
  mirrorPlaceholder: 'https://…',
  mirrorSave: 'Add',
  mirrorCancel: 'Cancel',
  mirrorRemove: 'Remove',
  mirrorRemoveA11y: 'Remove mirror {host}',
  mirrorInvalid: 'Enter an http or https link',
  mirrorPrivate: 'Links to private network addresses are not allowed',
  mirrorSame: 'This is the download’s own link',
  mirrorDuplicate: 'This mirror is already added',
  mirrorLimit: 'Up to {count} mirrors',
  mirrorFailed: 'Could not save the mirrors',
  mirrorsNone: 'No mirrors',
  // #347 Batch Add
  batchMirrorsHint: 'To add mirrors, put them after the link on the same line, separated by |',
  batchMirrorsAdded: '+{count} mirrors',
} as const;
