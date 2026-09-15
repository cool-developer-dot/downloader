/**
 * Detection strings: download button, "videos on this page" sheet, quality options, unsupported reasons.
 * `detection.ur.ts` must mirror these keys (tsc enforces it). Reference as `t('detection.<key>')`.
 */
export const detectionEn = {
  fab: {
    labelOne: 'Download: 1 video found on this page',
    labelOther: 'Download: {count} videos found on this page',
  },
  sheet: {
    title: 'Videos on this page',
    countOne: '1 video',
    countOther: '{count} videos',
    close: 'Close',
    emptyTitle: 'No videos found yet',
    emptyDescription: 'Play the video you want to save and it will show up here.',
    youtubeTitle: "YouTube isn't supported",
    youtubeDescription: "Videos from YouTube can't be downloaded.",
    drmNotice: "This page uses copy protection. Protected videos can't be saved.",
    downloadBest: 'Download best',
    downloadBestLabel: 'Download best quality: {title}',
    qualities: 'Qualities',
    qualitiesLabel: 'Qualities for {title}',
    download: 'Download',
    downloadQualityLabel: 'Download {quality}, {detail}',
    resolving: 'Finding qualities…',
    added: 'Added to Downloads',
    addedShort: 'Added',
    viewDownloads: 'View',
    retry: 'Try again',
    untitled: 'Untitled video',
  },
  option: {
    original: 'Original',
    noAudio: 'No audio',
    watermark: 'Watermark',
  },
  reason: {
    DRM_PROTECTED: 'DRM protected',
    LIVE_UNSUPPORTED: "Live streams can't be saved",
    UNSUPPORTED_FORMAT: 'Format not supported',
    NOT_MEDIA: "This isn't a video file",
    SOURCE_UNAVAILABLE: "Can't reach this video",
    POLICY_BLOCKED: "YouTube isn't supported",
  },
  error: {
    policyBlocked: "YouTube videos can't be downloaded.",
    runnerStart: "Couldn't start the download. Keep VidoraX open and try again.",
    invalidRequest: "This video can't be downloaded.",
    storage: "Couldn't save the file. Check your free storage and try again.",
    unavailable: "Downloads aren't available in this build of the app.",
    generic: "Couldn't add the download. Try again.",
  },
} as const;
